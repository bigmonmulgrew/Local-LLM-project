from __future__ import annotations

import base64
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status

from L3M_Web.api.dependencies import OllamaClientDependency, SettingsDependency
from L3M_Web.api.models.chat import (
    Chat,
    ChatSummary,
    CreateChatRequest,
    FileObject,
    Message,
    RenameChatRequest,
    SendMessageResponse,
)
from L3M_Web.api.services.ollama_chat import OllamaGenerationError, generate_chat_response
from L3M_Web.api.services.chat_store import chat_store

router = APIRouter(prefix="/api/chats", tags=["chats"])
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def require_non_blank(value: str, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} cannot be blank",
        )
    return cleaned


@router.get("", response_model=list[ChatSummary])
async def list_chats(
    user: str = Query(min_length=1, max_length=48),
) -> list[ChatSummary]:
    return await chat_store.list_chats(require_non_blank(user, "user"))


@router.post("", response_model=Chat, status_code=status.HTTP_201_CREATED)
async def create_chat(payload: CreateChatRequest) -> Chat:
    return await chat_store.create_chat(
        require_non_blank(payload.user, "user"),
        require_non_blank(payload.title, "title"),
    )


@router.get("/{chat_id}", response_model=Chat)
async def get_chat(
    chat_id: str,
    user: str = Query(min_length=1, max_length=48),
) -> Chat:
    chat = await chat_store.get_chat(require_non_blank(user, "user"), chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return chat


@router.patch("/{chat_id}", response_model=Chat)
async def rename_chat(chat_id: str, payload: RenameChatRequest) -> Chat:
    chat = await chat_store.rename_chat(
        require_non_blank(payload.user, "user"),
        chat_id,
        require_non_blank(payload.title, "title"),
    )
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return chat


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat(
    chat_id: str,
    user: str = Query(min_length=1, max_length=48),
) -> Response:
    deleted = await chat_store.delete_chat(require_non_blank(user, "user"), chat_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{chat_id}/messages",
    response_model=SendMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_message(
    chat_id: str,
    ollama_client: OllamaClientDependency,
    settings: SettingsDependency,
    user: str = Form(min_length=1, max_length=48),
    role: Literal["user", "assistant"] = Form(default="user"),
    text: str = Form(default=""),
    files: list[UploadFile] = File(default=[]),
) -> SendMessageResponse:
    if not text.strip() and not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A message requires text or at least one file",
        )

    clean_user = require_non_blank(user, "user")
    chat = await chat_store.get_chat(clean_user, chat_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    attachments: list[FileObject] = []
    encoded_images: list[str] = []
    total_bytes = 0
    try:
        for file in files:
            file_bytes = await file.read(MAX_FILE_BYTES + 1)
            if len(file_bytes) > MAX_FILE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"{file.filename or 'File'} exceeds the 10 MB limit",
                )

            total_bytes += len(file_bytes)
            if total_bytes > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Combined attachments exceed the 25 MB limit",
                )

            content_type = file.content_type or "application/octet-stream"
            attachments.append(
                FileObject(
                    id=str(uuid4()),
                    name=file.filename or "unnamed-file",
                    content_type=content_type,
                    size=len(file_bytes),
                )
            )
            if content_type.startswith("image/"):
                encoded_images.append(base64.b64encode(file_bytes).decode("ascii"))
    finally:
        for file in files:
            await file.close()

    stored_content = text.strip() or "Attached files"

    # Assistant messages can also enter through this endpoint without causing
    # another model call.
    if role == "assistant":
        message = await chat_store.add_message(
            user=clean_user,
            chat_id=chat_id,
            role=role,
            content=stored_content,
            attachments=attachments,
        )
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
        return SendMessageResponse(message=message)

    prompt_content = stored_content
    non_image_files = [
        attachment.name
        for attachment in attachments
        if not attachment.content_type.startswith("image/")
    ]
    if non_image_files:
        prompt_content += "\n\nAttached files (contents not yet available): " + ", ".join(non_image_files)

    ollama_messages: list[dict[str, object]] = [
        {"role": message.role, "content": message.content}
        for message in chat.messages
    ]
    current_message: dict[str, object] = {
        "role": "user",
        "content": prompt_content,
    }
    if encoded_images:
        current_message["images"] = encoded_images
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

    exchange = await chat_store.add_exchange(
        user=clean_user,
        chat_id=chat_id,
        user_content=stored_content,
        attachments=attachments,
        assistant_content=assistant_content,
    )
    if exchange is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    user_message, assistant_message = exchange
    return SendMessageResponse(
        message=user_message,
        generated_response=assistant_message,
    )