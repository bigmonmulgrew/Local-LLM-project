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
from L3M_Web.api.routes.chat import build_ollama_history
from L3M_Web.domain.attachments import ConversationMessage


SUPPORTED_TEXT_EXTENSIONS = (
    ".txt", ".md", ".log",
    ".json", ".yaml", ".yml", ".xml", ".toml", ".ini", ".cfg",
    ".csv", ".tsv",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
    ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs",
    ".php", ".rb", ".swift", ".kt", ".kts", ".sql",
    ".sh", ".bash", ".ps1", ".bat",
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
            await self.storage.encode_stored_images(stored),
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

    async def test_priority_one_text_extensions_are_supported(self) -> None:
        for extension in SUPPORTED_TEXT_EXTENSIONS:
            with self.subTest(extension=extension):
                upload = FakeUpload(
                    b"example UTF-8 content\n",
                    filename=f"example{extension}",
                    content_type="",
                )
                pending = await self.storage.prepare_uploads(
                    [upload],
                    max_files=5,
                    max_file_bytes=1024,
                    max_total_bytes=2048,
                )
                self.assertTrue(upload.closed)
                self.assertTrue(pending[0].stored_name.endswith(extension))

    async def test_text_is_stored_and_rendered_for_ollama(self) -> None:
        upload = FakeUpload(
            "Résumé notes\n- first item".encode(),
            filename="notes.md",
            content_type="text/markdown",
        )
        pending = await self.storage.prepare_uploads(
            [upload],
            max_files=5,
            max_file_bytes=1024,
            max_total_bytes=2048,
        )

        rendered_pending = self.storage.render_pending_text(pending)
        self.assertIn("BEGIN ATTACHED FILE: notes.md", rendered_pending)
        self.assertIn("Résumé notes", rendered_pending)
        self.assertEqual(await self.storage.encode_pending_images(pending), [])

        stored = await self.storage.persist(str(uuid4()), str(uuid4()), pending)
        self.assertEqual(
            await self.storage.render_stored_text(stored),
            rendered_pending,
        )
        self.assertEqual(await self.storage.encode_stored_images(stored), [])

    async def test_history_replays_text_and_images_in_their_ollama_fields(self) -> None:
        image_bytes = b"\x89PNG\r\n\x1a\n" + b"image"
        uploads = [
            FakeUpload(
                b"const answer = 42;",
                filename="answer.js",
                content_type="text/javascript",
            ),
            FakeUpload(
                image_bytes,
                filename="diagram.png",
                content_type="image/png",
            ),
        ]
        pending = await self.storage.prepare_uploads(
            uploads,
            max_files=5,
            max_file_bytes=1024,
            max_total_bytes=2048,
        )
        stored = await self.storage.persist(str(uuid4()), str(uuid4()), pending)

        messages = await build_ollama_history(
            self.storage,
            [ConversationMessage(
                role="user",
                content="Explain these files",
                attachments=tuple(stored),
            )],
        )

        self.assertIn("Explain these files", messages[0]["content"])
        self.assertIn("BEGIN ATTACHED FILE: answer.js", messages[0]["content"])
        self.assertIn("const answer = 42;", messages[0]["content"])
        self.assertEqual(
            messages[0]["images"],
            [base64.b64encode(image_bytes).decode("ascii")],
        )

    async def test_invalid_text_and_unsupported_extensions_are_rejected(self) -> None:
        invalid_uploads = (
            FakeUpload(b"\xff\xfe", filename="invalid.txt", content_type="text/plain"),
            FakeUpload(b"text\x00binary", filename="binary.txt", content_type="text/plain"),
            FakeUpload(b"%PDF-1.7", filename="document.pdf", content_type="application/pdf"),
            FakeUpload(b"SECRET=value", filename=".env", content_type="text/plain"),
        )

        for upload in invalid_uploads:
            with self.subTest(filename=upload.filename):
                with self.assertRaises(AttachmentError) as error:
                    await self.storage.prepare_uploads(
                        [upload],
                        max_files=5,
                        max_file_bytes=1024,
                        max_total_bytes=2048,
                    )
                self.assertEqual(error.exception.status_code, 415)
                self.assertTrue(upload.closed)


if __name__ == "__main__":
    unittest.main()
