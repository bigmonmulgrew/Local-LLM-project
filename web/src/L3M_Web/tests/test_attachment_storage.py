from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from L3M_Web.api.services.attachment_storage import (
    AttachmentError,
    AttachmentStorage,
)


class FakeUpload:
    def __init__(
        self,
        data: bytes,
        filename: str = "image.png",
        content_type: str = "image/png",
    ) -> None:
        self._data = data
        self.filename = filename
        self.content_type = content_type
        self.closed = False

    async def read(self, size: int = -1) -> bytes:
        return self._data if size < 0 else self._data[:size]

    async def close(self) -> None:
        self.closed = True


class AttachmentStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.storage = AttachmentStorage(self.root)
        await self.storage.ensure_root()

    async def asyncTearDown(self) -> None:
        self.temporary_directory.cleanup()

    async def test_valid_image_is_hashed_stored_and_reloaded(self) -> None:
        image_bytes = b"\x89PNG\r\n\x1a\n" + b"test-image-data"
        upload = FakeUpload(image_bytes, filename="../example.png")

        pending = await self.storage.prepare_uploads(
            [upload],
            max_files=5,
            max_file_bytes=1024,
            max_total_bytes=2048,
        )
        self.assertTrue(upload.closed)
        self.assertEqual(pending[0].name, "example.png")
        self.assertEqual(pending[0].content_type, "image/png")

        user_id = str(uuid4())
        chat_id = str(uuid4())
        stored = await self.storage.persist(user_id, chat_id, pending)
        stored_path = self.root / stored[0].storage_path
        self.assertEqual(stored_path.read_bytes(), image_bytes)
        self.assertEqual(
            await self.storage.encode_stored(stored),
            [base64.b64encode(image_bytes).decode("ascii")],
        )

        await self.storage.delete_chat(user_id, chat_id)
        self.assertFalse(stored_path.exists())

    async def test_declared_type_must_match_file_signature(self) -> None:
        upload = FakeUpload(
            b"\x89PNG\r\n\x1a\ncontent",
            content_type="image/jpeg",
        )

        with self.assertRaisesRegex(AttachmentError, "declared type"):
            await self.storage.prepare_uploads(
                [upload],
                max_files=5,
                max_file_bytes=1024,
                max_total_bytes=2048,
            )
        self.assertTrue(upload.closed)

    async def test_file_and_combined_limits_are_enforced(self) -> None:
        oversized = FakeUpload(b"\x89PNG\r\n\x1a\n" + b"x" * 20)
        with self.assertRaises(AttachmentError) as error:
            await self.storage.prepare_uploads(
                [oversized],
                max_files=5,
                max_file_bytes=16,
                max_total_bytes=32,
            )
        self.assertEqual(error.exception.status_code, 413)

        uploads = [
            FakeUpload(b"\x89PNG\r\n\x1a\n" + b"a" * 8),
            FakeUpload(b"\x89PNG\r\n\x1a\n" + b"b" * 8),
        ]
        with self.assertRaises(AttachmentError) as error:
            await self.storage.prepare_uploads(
                uploads,
                max_files=5,
                max_file_bytes=32,
                max_total_bytes=24,
            )
        self.assertEqual(error.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()