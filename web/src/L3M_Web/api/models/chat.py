from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

MessageRole = Literal["user", "assistant"]


class User(BaseModel):
    id: str
    username: str
    created_at: datetime
    updated_at: datetime


class ResolveUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=48)


class FileObject(BaseModel):
    id: str
    name: str
    content_type: str
    size: int = Field(ge=0)
    sha256: str = Field(min_length=64, max_length=64)


class Message(BaseModel):
    id: str
    role: MessageRole
    content: str
    attachments: list[FileObject] = Field(default_factory=list)
    created_at: datetime


class ChatSummary(BaseModel):
    id: str
    user_id: str
    user: str
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int
    last_message_preview: str


class Chat(BaseModel):
    id: str
    user_id: str
    user: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[Message] = Field(default_factory=list)


class CreateChatRequest(BaseModel):
    user_id: str = Field(min_length=36, max_length=36)
    title: str = Field(default="New conversation", min_length=1, max_length=80)


class RenameChatRequest(BaseModel):
    user_id: str = Field(min_length=36, max_length=36)
    title: str = Field(min_length=1, max_length=80)


class SendMessageResponse(BaseModel):
    message: Message
    generated_response: Message | None = None