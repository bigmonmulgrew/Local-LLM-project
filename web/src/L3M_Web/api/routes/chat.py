from __future__ import annotations

from typing import Literal

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)

from L3M_Web.api.dependencies import (
    DatabaseSessionDependency,
    OllamaClientDependency,
    SettingsDependency,
)
from L3M_Web.api.models.chat import (
    Chat,
    ChatSummary,
    CreateChatRequest,
    RenameChatRequest,
    SendMessageResponse,
)
from L3M_Web.api.services.attachment_storage import (
    AttachmentError,
    AttachmentStorage,
    PendingAttachment,
)
from L3M_Web.api.services.ollama_chat import (
    OllamaGenerationError,
    OllamaMessage,
    generate_chat_response,
)
from L3M_Web.database.chat_repository import ChatRepository
from L3M_Web.domain.attachments import ConversationMessage, StoredAttachment

router = APIRouter(prefix="/api/chats", tags=["chats"])


def require_non_blank(value: str, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} cannot be blank",
        )
    return cleaned


def attachment_http_exception(error: AttachmentError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=str(error))


async def prepare_attachments(
    storage: AttachmentStorage,
    files: list[UploadFile],
    settings: SettingsDependency,
) -> list[PendingAttachment]:
    try:
        return await storage.prepare_uploads(
            files,
            max_files=settings.max_upload_files,
            max_file_bytes=settings.max_upload_file_bytes,
            max_total_bytes=settings.max_upload_total_bytes,
        )
    except AttachmentError as exc:
        raise attachment_http_exception(exc) from exc


async def persist_attachments(
    storage: AttachmentStorage,
    user_id: str,
    chat_id: str,
    attachments: list[PendingAttachment],
) -> list[StoredAttachment]:
    try:
        return await storage.persist(user_id, chat_id, attachments)
    except AttachmentError as exc:
        raise attachment_http_exception(exc) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not store the uploaded files",
        ) from exc


async def build_ollama_history(
    storage: AttachmentStorage,
    history: list[ConversationMessage],
) -> list[OllamaMessage]:
    messages: list[OllamaMessage] = []
    try:
        for message in history:
            ollama_message = OllamaMessage(
                role=message.role,
                content=message.content,
            )
            if message.attachments:
                ollama_message["images"] = await storage.encode_stored(
                    message.attachments
                )
            messages.append(ollama_message)
    except AttachmentError as exc:
        raise attachment_http_exception(exc) from exc
    return messages


@router.get("", response_model=list[ChatSummary])
async def list_chats(
    session: DatabaseSessionDependency,
    user_id: str = Query(min_length=36, max_length=36),
) -> list[ChatSummary]:
    return await ChatRepository(session).list_chats(user_id)


@router.post("", response_model=Chat, status_code=status.HTTP_201_CREATED)
async def create_chat(
    payload: CreateChatRequest,
    session: DatabaseSessionDependency,
) -> Chat:
    chat = await ChatRepository(session).create_chat(
        payload.user_id,
        require_non_blank(payload.title, "title"),
    )
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return chat


@router.get("/{chat_id}", response_model=Chat)
async def get_chat(
    chat_id: str,
    session: DatabaseSessionDependency,
    user_id: str = Query(min_length=36, max_length=36),
) -> Chat:
    chat = await ChatRepository(session).get_chat(user_id, chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )
    return chat


@router.patch("/{chat_id}", response_model=Chat)
async def rename_chat(
    chat_id: str,
    payload: RenameChatRequest,
    session: DatabaseSessionDependency,
) -> Chat:
    chat = await ChatRepository(session).rename_chat(
        payload.user_id,
        chat_id,
        require_non_blank(payload.title, "title"),
    )
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )
    return chat


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: str,
    session: DatabaseSessionDependency,
    settings: SettingsDependency,
    user_id: str = Query(min_length=36, max_length=36),
) -> Response:
    deleted = await ChatRepository(session).delete_chat(user_id, chat_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )
    await AttachmentStorage(settings.upload_directory).delete_chat(
        user_id,
        chat_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{chat_id}/messages",
    response_model=SendMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_message(
    chat_id: str,
    session: DatabaseSessionDependency,
    ollama_client: OllamaClientDependency,
    settings: SettingsDependency,
    user_id: str = Form(min_length=36, max_length=36),
    role: Literal["user", "assistant"] = Form(default="user"),
    text: str = Form(default=""),
    files: list[UploadFile] = File(default=[]),
) -> SendMessageResponse:
    if not text.strip() and not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A message requires text or at least one file",
        )

    repository = ChatRepository(session)
    history = await repository.get_generation_history(user_id, chat_id)
    if history is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )

    storage = AttachmentStorage(settings.upload_directory)
    pending_attachments = await prepare_attachments(storage, files, settings)

    stored_content = text.strip() or "Attached images"
    if role == "assistant":
        stored_attachments = await persist_attachments(
            storage,
            user_id,
            chat_id,
            pending_attachments,
        )
        try:
            message = await repository.add_message(
                user_id=user_id,
                chat_id=chat_id,
                role=role,
                content=stored_content,
                attachments=stored_attachments,
            )
        except Exception:
            await storage.delete(stored_attachments)
            raise
        if message is None:
            await storage.delete(stored_attachments)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found",
            )
        return SendMessageResponse(message=message)

    ollama_messages = await build_ollama_history(storage, history)
    current_message = OllamaMessage(role="user", content=stored_content)
    if pending_attachments:
        current_message["images"] = await storage.encode_pending(
            pending_attachments
        )
    ollama_messages.append(current_message)

    if ollama_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ollama is not available",
        )

    try:
        assistant_content = await generate_chat_response(
            client=ollama_client,
            model=settings.ollama_model,
            messages=ollama_messages,
        )
    except OllamaGenerationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    stored_attachments = await persist_attachments(
        storage,
        user_id,
        chat_id,
        pending_attachments,
    )
    try:
        exchange = await repository.add_exchange(
            user_id=user_id,
            chat_id=chat_id,
            user_content=stored_content,
            attachments=stored_attachments,
            assistant_content=assistant_content,
        )
    except Exception:
        await storage.delete(stored_attachments)
        raise
    if exchange is None:
        await storage.delete(stored_attachments)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )

    user_message, assistant_message = exchange
    return SendMessageResponse(
        message=user_message,
        generated_response=assistant_message,
    )