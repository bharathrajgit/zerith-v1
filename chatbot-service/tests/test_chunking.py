import tempfile
import unittest
from pathlib import Path

from app.chunking import chunk_documents, chunk_text, load_corpus_documents


class ChunkingTests(unittest.TestCase):
    def test_chunks_overlap_and_cover_the_text(self):
        text = " ".join("word{}".format(index) for index in range(100))

        chunks = chunk_text(text, chunk_size=100, overlap=20)

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 100 for chunk in chunks))
        self.assertIn(chunks[0].split()[-1], chunks[1].split()[:4])
        self.assertIn("word99", chunks[-1])

    def test_invalid_overlap_is_rejected(self):
        with self.assertRaises(ValueError):
            chunk_text("text", chunk_size=10, overlap=10)

    def test_loader_reads_supported_documents_and_jsonl_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "notes.md").write_text("# Notes\nArrays", encoding="utf-8")
            (root / "examples.jsonl").write_text(
                '{"topic":"arrays"}\n\n{"topic":"queues"}\n',
                encoding="utf-8",
            )
            (root / "ignored.csv").write_text("not loaded", encoding="utf-8")

            documents = load_corpus_documents(root)
            chunks = chunk_documents(documents, chunk_size=100, overlap=10)

        self.assertEqual(len(documents), 3)
        self.assertEqual(
            [document["source"] for document in documents],
            ["examples.jsonl:1", "examples.jsonl:3", "notes.md"],
        )
        self.assertTrue(all(chunk["text"] for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
