from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status

from L3M_Web.api.models.chat import (
    Chat,
    ChatSummary,
    CreateChatRequest,
    FileObject,
    Message,
    RenameChatRequest,
)
from L3M_Web.api.services.chat_store import chat_store

router = APIRouter(prefix="/api/chats", tags=["chats"])


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
    response_model=Message,
    status_code=status.HTTP_201_CREATED,
)
async def add_message(
    chat_id: str,
    user: str = Form(min_length=1, max_length=48),
    role: Literal["user", "assistant"] = Form(default="user"),
    text: str = Form(default=""),
    files: list[UploadFile] = File(default=[]),
) -> Message:
    if not text.strip() and not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A message requires text or at least one file",
        )

    attachments = [
        FileObject(
            id=str(uuid4()),
            name=file.filename or "unnamed-file",
            content_type=file.content_type or "application/octet-stream",
            size=max(getattr(file, "size", 0) or 0, 0),
        )
        for file in files
    ]

    for file in files:
        await file.close()

    message = await chat_store.add_message(
        user=require_non_blank(user, "user"),
        chat_id=chat_id,
        role=role,
        content=text,
        attachments=attachments,
    )
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return message