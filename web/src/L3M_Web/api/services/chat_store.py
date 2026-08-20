from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from L3M_Web.api.models.chat import (
    Chat,
    ChatSummary,
    FileObject,
    Message,
    MessageRole,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PlaceholderChatStore:
    """Temporary in-memory store. Replace this class with a SQL repository later."""

    def __init__(self) -> None:
        self._chats_by_user: dict[str, list[Chat]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _user_key(user: str) -> str:
        return user.strip().casefold() or "guest"

    def _seed_user(self, user: str) -> list[Chat]:
        key = self._user_key(user)
        if key in self._chats_by_user:
            return self._chats_by_user[key]

        display_name = user.strip() or "Guest"
        now = utc_now()
        conversations = [
            (
                "Chat 1",
                [
                    ("user", "Hello! Can you help me test this chat?"),
                    ("assistant", "Of course. This conversation was loaded from the placeholder backend."),
                ],
            ),
            (
                "Chat 2",
                [
                    ("user", "Show me a small Python example."),
                    ("assistant", "Here is one:\n\n```python\nfor item in range(3):\n    print(item)\n```"),
                ],
            ),
            (
                "Chat 3",
                [
                    ("user", "> This is placeholder content."),
                    ("assistant", "When the SQL repository is added, this data source can be replaced without changing the API."),
                ],
            ),
        ]

        chats: list[Chat] = []
        for title, seed_messages in conversations:
            messages = [
                Message(
                    id=str(uuid4()),
                    role=role,
                    content=content,
                    created_at=now,
                )
                for role, content in seed_messages
            ]
            chats.append(
                Chat(
                    id=str(uuid4()),
                    user=display_name,
                    title=title,
                    created_at=now,
                    updated_at=now,
                    messages=messages,
                )
            )

        self._chats_by_user[key] = chats
        return chats

    @staticmethod
    def _summary(chat: Chat) -> ChatSummary:
        last_message = chat.messages[-1].content if chat.messages else ""
        return ChatSummary(
            id=chat.id,
            user=chat.user,
            title=chat.title,
            created_at=chat.created_at,
            updated_at=chat.updated_at,
            message_count=len(chat.messages),
            last_message_preview=last_message.replace("\n", " ")[:100],
        )

    async def list_chats(self, user: str) -> list[ChatSummary]:
        async with self._lock:
            chats = self._seed_user(user)
            ordered = sorted(chats, key=lambda chat: chat.updated_at, reverse=True)
            return [deepcopy(self._summary(chat)) for chat in ordered]

    async def get_chat(self, user: str, chat_id: str) -> Chat | None:
        async with self._lock:
            chats = self._seed_user(user)
            chat = next((item for item in chats if item.id == chat_id), None)
            return deepcopy(chat) if chat else None

    async def create_chat(self, user: str, title: str) -> Chat:
        async with self._lock:
            chats = self._seed_user(user)
            now = utc_now()
            chat = Chat(
                id=str(uuid4()),
                user=user.strip() or "Guest",
                title=title.strip() or "New conversation",
                created_at=now,
                updated_at=now,
            )
            chats.insert(0, chat)
            return deepcopy(chat)

    async def rename_chat(self, user: str, chat_id: str, title: str) -> Chat | None:
        async with self._lock:
            chats = self._seed_user(user)
            chat = next((item for item in chats if item.id == chat_id), None)
            if chat is None:
                return None
            chat.title = title.strip()
            chat.updated_at = utc_now()
            return deepcopy(chat)

    async def delete_chat(self, user: str, chat_id: str) -> bool:
        async with self._lock:
            chats = self._seed_user(user)
            original_length = len(chats)
            chats[:] = [chat for chat in chats if chat.id != chat_id]
            return len(chats) != original_length

    async def add_message(
        self,
        user: str,
        chat_id: str,
        role: MessageRole,
        content: str,
        attachments: list[FileObject],
    ) -> Message | None:
        async with self._lock:
            chats = self._seed_user(user)
            chat = next((item for item in chats if item.id == chat_id), None)
            if chat is None:
                return None

            message = Message(
                id=str(uuid4()),
                role=role,
                content=content.strip(),
                attachments=attachments,
                created_at=utc_now(),
            )
            chat.messages.append(message)
            chat.updated_at = message.created_at
            return deepcopy(message)


chat_store = PlaceholderChatStore()