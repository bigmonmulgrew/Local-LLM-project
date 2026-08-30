"""Validation and filesystem persistence for chat attachments."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence
from uuid import UUID, uuid4

from L3M_Web.domain.attachments import StoredAttachment


IMAGE_SIGNATURES = {
    "image/jpeg": lambda data: data.startswith(b"\xff\xd8\xff"),
    "image/png": lambda data: data.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda data: (
        len(data) >= 12
        and data.startswith(b"RIFF")
        and data[8:12] == b"WEBP"
    ),
}

IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

TEXT_CONTENT_TYPES_BY_EXTENSION = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".log": "text/plain",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".xml": "application/xml",
    ".toml": "application/toml",
    ".ini": "text/plain",
    ".cfg": "text/plain",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".py": "text/plain",
    ".js": "text/javascript",
    ".ts": "text/plain",
    ".jsx": "text/javascript",
    ".tsx": "text/plain",
    ".html": "text/html",
    ".css": "text/css",
    ".scss": "text/plain",
    ".java": "text/plain",
    ".c": "text/plain",
    ".h": "text/plain",
    ".cpp": "text/plain",
    ".hpp": "text/plain",
    ".cs": "text/plain",
    ".go": "text/plain",
    ".rs": "text/plain",
    ".php": "text/plain",
    ".rb": "text/plain",
    ".swift": "text/plain",
    ".kt": "text/plain",
    ".kts": "text/plain",
    ".sql": "text/plain",
    ".sh": "text/plain",
    ".bash": "text/plain",
    ".ps1": "text/plain",
    ".bat": "text/plain",
}

TEXT_CONTENT_TYPES = frozenset(TEXT_CONTENT_TYPES_BY_EXTENSION.values())


class ReadableUpload(Protocol):
    """Small subset of FastAPI's UploadFile used by this service."""

    filename: str | None
    content_type: str | None

    async def read(self, size: int = -1) -> bytes: ...

    async def close(self) -> None: ...


class AttachmentError(ValueError):
    """Base error for an invalid upload or unavailable stored attachment."""

    def __init__(self, message: str, *, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class PendingAttachment:
    """Validated bytes retained in memory until Ollama succeeds."""

    id: str
    name: str
    stored_name: str
    content_type: str
    size: int
    sha256: str
    data: bytes


def _safe_original_name(filename: str | None) -> str:
    # Browsers normally send only the basename, but explicitly discard either
    # path separator so client-supplied paths never become storage paths.
    name = (filename or "unnamed-file").replace("\\", "/").rsplit("/", 1)[-1]
    name = name.strip() or "unnamed-file"
    return name[:255]


def _detect_image_type(data: bytes) -> str | None:
    for content_type, matches in IMAGE_SIGNATURES.items():
        if matches(data):
            return content_type
    return None


def _decode_text(data: bytes, name: str) -> str:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AttachmentError(f"{name} must contain valid UTF-8 text", status_code=415) from exc

    if any(
        ord(character) < 32 and character not in "\t\n\r\f"
        for character in text
    ):
        raise AttachmentError(f"{name} contains binary data", status_code=415)
    return text


def _format_text_attachment(name: str, data: bytes) -> str:
    content = _decode_text(data, name)
    return (
        f"--- BEGIN ATTACHED FILE: {name} ---\n"
        f"{content}\n"
        f"--- END ATTACHED FILE: {name} ---"
    )


def _is_image(content_type: str) -> bool:
    return content_type in IMAGE_EXTENSIONS


def _is_text(content_type: str) -> bool:
    return content_type in TEXT_CONTENT_TYPES


def _uuid_component(value: str, label: str) -> str:
    try:
        return str(UUID(value))
    except (TypeError, ValueError) as exc:
        raise AttachmentError(f"Invalid {label}", status_code=500) from exc


class AttachmentStorage:
    """Store attachment bytes below a configured, non-public directory."""

    def __init__(self, root: Path) -> None:
        self._root = root.expanduser().resolve()

    async def ensure_root(self) -> None:
        await asyncio.to_thread(self._root.mkdir, parents=True, exist_ok=True)

    async def prepare_uploads(
        self,
        uploads: Sequence[ReadableUpload],
        *,
        max_files: int,
        max_file_bytes: int,
        max_total_bytes: int,
    ) -> list[PendingAttachment]:
        """Read, validate and hash supported uploads, closing every input file."""

        pending: list[PendingAttachment] = []
        total_bytes = 0
        try:
            if len(uploads) > max_files:
                raise AttachmentError(f"A message can contain at most {max_files} files")

            for upload in uploads:
                data = await upload.read(max_file_bytes + 1)
                name = _safe_original_name(upload.filename)
                if not data:
                    raise AttachmentError(f"{name} is empty")
                if len(data) > max_file_bytes:
                    raise AttachmentError(f"{name} exceeds the {max_file_bytes // (1024 * 1024)} MB limit", status_code=413)

                total_bytes += len(data)
                if total_bytes > max_total_bytes:
                    raise AttachmentError("Combined attachments exceed the upload limit", status_code=413)

                declared_type = (upload.content_type or "").split(";", 1)[0].lower()
                detected_type = _detect_image_type(data)
                if detected_type is not None:
                    if declared_type and declared_type not in {
                        detected_type,
                        "application/octet-stream",
                    }:
                        raise AttachmentError(
                            f"{name} content does not match its declared type", status_code=415)
                    
                    content_type = detected_type
                    extension = IMAGE_EXTENSIONS[detected_type]
                else:
                    extension = Path(name).suffix.lower()
                    content_type = TEXT_CONTENT_TYPES_BY_EXTENSION.get(extension)
                    if content_type is None:
                        raise AttachmentError(f"{name} is not a supported attachment type", status_code=415)
                    _decode_text(data, name)

                attachment_id = str(uuid4())
                stored_name = f"{attachment_id}{extension}"
                pending.append(
                    PendingAttachment(
                        id=attachment_id,
                        name=name,
                        stored_name=stored_name,
                        content_type=content_type,
                        size=len(data),
                        sha256=hashlib.sha256(data).hexdigest(),
                        data=data,
                    )
                )
        finally:
            for upload in uploads:
                await upload.close()

        return pending

    async def persist(
        self,
        user_id: str,
        chat_id: str,
        attachments: Sequence[PendingAttachment],
    ) -> list[StoredAttachment]:
        """Atomically write validated attachments and return DB metadata."""

        if not attachments:
            return []

        user_component = _uuid_component(user_id, "user ID")
        chat_component = _uuid_component(chat_id, "chat ID")
        relative_directory = Path(user_component) / chat_component
        destination_directory = self._root / relative_directory
        await asyncio.to_thread(
            destination_directory.mkdir,
            parents=True,
            exist_ok=True,
        )

        stored: list[StoredAttachment] = []
        try:
            for attachment in attachments:
                relative_path = relative_directory / attachment.stored_name
                destination = self._root / relative_path
                temporary = destination.with_name(f".{destination.name}.pending")
                try:
                    await asyncio.to_thread(temporary.write_bytes, attachment.data)
                    await asyncio.to_thread(os.replace, temporary, destination)
                finally:
                    await asyncio.to_thread(temporary.unlink, missing_ok=True)
                stored.append(
                    StoredAttachment(
                        id=attachment.id,
                        name=attachment.name,
                        stored_name=attachment.stored_name,
                        content_type=attachment.content_type,
                        size=attachment.size,
                        sha256=attachment.sha256,
                        storage_path=relative_path.as_posix(),
                    )
                )
        except Exception:
            await self.delete(stored)
            raise

        return stored

    async def encode_pending_images(
        self,
        attachments: Sequence[PendingAttachment],
    ) -> list[str]:
        return [
            base64.b64encode(attachment.data).decode("ascii")
            for attachment in attachments
            if _is_image(attachment.content_type)
        ]

    async def encode_stored_images(
        self,
        attachments: Sequence[StoredAttachment],
    ) -> list[str]:
        return list(await asyncio.gather(*(
            self._read_and_encode(attachment)
            for attachment in attachments
            if _is_image(attachment.content_type)
        )))

    def render_pending_text(
        self,
        attachments: Sequence[PendingAttachment],
    ) -> str:
        return "\n\n".join(
            _format_text_attachment(attachment.name, attachment.data)
            for attachment in attachments
            if _is_text(attachment.content_type)
        )

    async def render_stored_text(
        self,
        attachments: Sequence[StoredAttachment],
    ) -> str:
        rendered = await asyncio.gather(*(
            self._read_and_format_text(attachment)
            for attachment in attachments
            if _is_text(attachment.content_type)
        ))
        return "\n\n".join(rendered)

    async def _read_and_encode(self, attachment: StoredAttachment) -> str:
        data = await self._read_verified(attachment)
        return base64.b64encode(data).decode("ascii")

    async def _read_and_format_text(self, attachment: StoredAttachment) -> str:
        data = await self._read_verified(attachment)
        return _format_text_attachment(attachment.name, data)

    async def _read_verified(self, attachment: StoredAttachment) -> bytes:
        path = self._resolve_storage_path(attachment.storage_path)
        try:
            data = await asyncio.to_thread(path.read_bytes)
        except OSError as exc:
            raise AttachmentError(
                f"Stored attachment {attachment.name} is unavailable",
                status_code=500,
            ) from exc

        if hashlib.sha256(data).hexdigest() != attachment.sha256:
            raise AttachmentError(
                f"Stored attachment {attachment.name} failed integrity checking",
                status_code=500,
            )
        return data

    def _resolve_storage_path(self, storage_path: str) -> Path:
        candidate = (self._root / storage_path).resolve()
        try:
            candidate.relative_to(self._root)
        except ValueError as exc:
            raise AttachmentError("Stored attachment path is invalid", status_code=500) from exc
        return candidate

    async def delete(self, attachments: Sequence[StoredAttachment]) -> None:
        for attachment in attachments:
            path = self._resolve_storage_path(attachment.storage_path)
            await asyncio.to_thread(path.unlink, missing_ok=True)

    async def delete_chat(self, user_id: str, chat_id: str) -> None:
        user_component = _uuid_component(user_id, "user ID")
        chat_component = _uuid_component(chat_id, "chat ID")
        directory = self._root / user_component / chat_component
        await asyncio.to_thread(shutil.rmtree, directory, True)
