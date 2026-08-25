from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from L3M_Web.api.models.chat import (
    Chat,
    ChatSummary,
    FileObject,
    Message,
    MessageRole,
    User,
)
from L3M_Web.database.models import (
    ChatModel,
    MessageFileModel,
    MessageModel,
    UserModel,
)
from L3M_Web.domain.attachments import ConversationMessage, StoredAttachment


def utc_now() -> datetime:
    # MySQL DATETIME values do not retain timezone information.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def file_to_schema(file: MessageFileModel) -> FileObject:
    return FileObject(
        id=file.id,
        name=file.name,
        content_type=file.content_type,
        size=file.size_bytes,
        sha256=file.sha256,
    )


def stored_file_to_schema(file: StoredAttachment) -> FileObject:
    return FileObject(
        id=file.id,
        name=file.name,
        content_type=file.content_type,
        size=file.size,
        sha256=file.sha256,
    )


def file_to_domain(file: MessageFileModel) -> StoredAttachment:
    return StoredAttachment(
        id=file.id,
        name=file.name,
        stored_name=file.stored_name,
        content_type=file.content_type,
        size=file.size_bytes,
        sha256=file.sha256,
        storage_path=file.storage_path,
    )


def message_to_schema(message: MessageModel) -> Message:
    return Message(
        id=message.id,
        role=message.role,
        content=message.content,
        attachments=[file_to_schema(file) for file in message.attachments],
        created_at=message.created_at,
    )


def chat_to_schema(chat: ChatModel) -> Chat:
    return Chat(
        id=chat.id,
        user_id=chat.user_id,
        user=chat.user.username,
        title=chat.title,
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        messages=[message_to_schema(message) for message in chat.messages],
    )


class ChatRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def resolve_user(self, username: str) -> User:
        display_name = username.strip()
        normalized = display_name.casefold()
        statement = select(UserModel).where(
            UserModel.username_normalized == normalized
        )
        existing = await self._session.scalar(statement)
        if existing is not None:
            if existing.username != display_name:
                existing.username = display_name
                existing.updated_at = utc_now()
                await self._session.commit()
            return User(
                id=existing.id,
                username=existing.username,
                created_at=existing.created_at,
                updated_at=existing.updated_at,
            )

        now = utc_now()
        user = UserModel(
            id=str(uuid4()),
            username=display_name,
            username_normalized=normalized,
            created_at=now,
            updated_at=now,
        )
        self._session.add(user)
        try:
            await self._session.commit()
        except IntegrityError:
            # A concurrent confirmation may have created the same user.
            await self._session.rollback()
            user = await self._session.scalar(statement)
            if user is None:
                raise

        return User(
            id=user.id,
            username=user.username,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )

    async def list_chats(self, user_id: str) -> list[ChatSummary]:
        message_count = (
            select(func.count(MessageModel.id))
            .where(MessageModel.chat_id == ChatModel.id)
            .correlate(ChatModel)
            .scalar_subquery()
        )
        latest_content = (
            select(MessageModel.content)
            .where(MessageModel.chat_id == ChatModel.id)
            .order_by(MessageModel.created_at.desc(), MessageModel.id.desc())
            .limit(1)
            .correlate(ChatModel)
            .scalar_subquery()
        )
        statement = (
            select(
                ChatModel,
                UserModel.username,
                message_count.label("message_count"),
                func.coalesce(latest_content, "").label("last_message_preview"),
            )
            .join(UserModel, UserModel.id == ChatModel.user_id)
            .where(ChatModel.user_id == user_id)
            .order_by(ChatModel.updated_at.desc(), ChatModel.id.desc())
        )
        rows = (await self._session.execute(statement)).all()
        summaries = [
            ChatSummary(
                id=chat.id,
                user_id=chat.user_id,
                user=username,
                title=chat.title,
                created_at=chat.created_at,
                updated_at=chat.updated_at,
                message_count=message_count_value,
                last_message_preview=last_message_preview.replace("\n", " ")[:100],
            )
            for chat, username, message_count_value, last_message_preview in rows
        ]
        await self._session.commit()
        return summaries

    async def get_chat(self, user_id: str, chat_id: str) -> Chat | None:
        statement = (
            select(ChatModel)
            .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
            .options(
                selectinload(ChatModel.user),
                selectinload(ChatModel.messages).selectinload(
                    MessageModel.attachments
                ),
            )
        )
        chat = await self._session.scalar(statement)
        result = chat_to_schema(chat) if chat is not None else None
        await self._session.commit()
        return result

    async def get_generation_history(
        self,
        user_id: str,
        chat_id: str,
    ) -> list[ConversationMessage] | None:
        """Return ordered messages with the storage metadata Ollama needs."""

        chat_exists = await self._session.scalar(
            select(ChatModel.id).where(
                ChatModel.id == chat_id,
                ChatModel.user_id == user_id,
            )
        )
        if chat_exists is None:
            await self._session.commit()
            return None

        statement = (
            select(MessageModel)
            .where(MessageModel.chat_id == chat_id)
            .options(selectinload(MessageModel.attachments))
            .order_by(MessageModel.created_at)
        )
        messages = (await self._session.scalars(statement)).all()
        history = [
            ConversationMessage(
                role=message.role,
                content=message.content,
                attachments=tuple(
                    file_to_domain(file)
                    for file in message.attachments
                ),
            )
            for message in messages
        ]
        await self._session.commit()
        return history

    async def create_chat(self, user_id: str, title: str) -> Chat | None:
        user = await self._session.get(UserModel, user_id)
        if user is None:
            await self._session.commit()
            return None

        now = utc_now()
        chat = ChatModel(
            id=str(uuid4()),
            user_id=user_id,
            title=title,
            created_at=now,
            updated_at=now,
        )
        self._session.add(chat)
        await self._session.commit()
        return Chat(
            id=chat.id,
            user_id=user_id,
            user=user.username,
            title=chat.title,
            created_at=chat.created_at,
            updated_at=chat.updated_at,
        )

    async def rename_chat(
        self,
        user_id: str,
        chat_id: str,
        title: str,
    ) -> Chat | None:
        statement = (
            select(ChatModel)
            .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
            .options(
                selectinload(ChatModel.user),
                selectinload(ChatModel.messages).selectinload(
                    MessageModel.attachments
                ),
            )
        )
        chat = await self._session.scalar(statement)
        if chat is None:
            await self._session.commit()
            return None

        chat.title = title
        chat.updated_at = utc_now()
        result = chat_to_schema(chat)
        await self._session.commit()
        return result

    async def delete_chat(self, user_id: str, chat_id: str) -> bool:
        statement = select(ChatModel).where(
            ChatModel.id == chat_id,
            ChatModel.user_id == user_id,
        )
        chat = await self._session.scalar(statement)
        if chat is None:
            await self._session.commit()
            return False
        await self._session.delete(chat)
        await self._session.commit()
        return True

    @staticmethod
    def build_attachment(file: StoredAttachment) -> MessageFileModel:
        return MessageFileModel(
            id=file.id,
            name=file.name,
            stored_name=file.stored_name,
            content_type=file.content_type,
            size_bytes=file.size,
            sha256=file.sha256,
            storage_path=file.storage_path,
            created_at=utc_now(),
        )

    async def add_message(
        self,
        user_id: str,
        chat_id: str,
        role: MessageRole,
        content: str,
        attachments: list[StoredAttachment],
    ) -> Message | None:
        statement = (
            select(ChatModel)
            .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
            .with_for_update()
        )
        chat = await self._session.scalar(statement)
        if chat is None:
            await self._session.rollback()
            return None

        now = utc_now()
        message = MessageModel(
            id=str(uuid4()),
            chat_id=chat_id,
            role=role,
            content=content.strip(),
            created_at=now,
            attachments=[
                self.build_attachment(file)
                for file in attachments
            ],
        )
        chat.updated_at = now
        self._session.add(message)
        await self._session.commit()
        return Message(
            id=message.id,
            role=role,
            content=message.content,
            attachments=[stored_file_to_schema(file) for file in attachments],
            created_at=message.created_at,
        )

    async def add_exchange(
        self,
        user_id: str,
        chat_id: str,
        user_content: str,
        attachments: list[StoredAttachment],
        assistant_content: str,
    ) -> tuple[Message, Message] | None:
        statement = (
            select(ChatModel)
            .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
            .with_for_update()
        )
        chat = await self._session.scalar(statement)
        if chat is None:
            await self._session.rollback()
            return None

        user_created_at = utc_now()
        assistant_created_at = user_created_at + timedelta(microseconds=1)
        user_message = MessageModel(
            id=str(uuid4()),
            chat_id=chat_id,
            role="user",
            content=user_content.strip(),
            created_at=user_created_at,
            attachments=[
                self.build_attachment(file)
                for file in attachments
            ],
        )
        assistant_message = MessageModel(
            id=str(uuid4()),
            chat_id=chat_id,
            role="assistant",
            content=assistant_content.strip(),
            created_at=assistant_created_at,
        )
        chat.updated_at = assistant_created_at
        self._session.add_all((user_message, assistant_message))
        await self._session.commit()

        return (
            Message(
                id=user_message.id,
                role="user",
                content=user_message.content,
                attachments=[
                    stored_file_to_schema(file)
                    for file in attachments
                ],
                created_at=user_message.created_at,
            ),
            Message(
                id=assistant_message.id,
                role="assistant",
                content=assistant_message.content,
                created_at=assistant_message.created_at,
            ),
        )