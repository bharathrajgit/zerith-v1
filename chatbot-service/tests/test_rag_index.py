import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from qdrant_client import QdrantClient

from app import rag


class RagIndexTests(unittest.TestCase):
    def test_local_index_can_be_refreshed_and_retrieved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            corpus = root / "corpus"
            corpus.mkdir()
            (corpus / "arrays.md").write_text(
                "Array boundaries matter. " * 20,
                encoding="utf-8",
            )
            client = QdrantClient(path=str(root / "vectors"))

            try:
                with (
                    patch.object(rag, "qdrant", client),
                    patch.object(rag, "QDRANT_COLLECTION", "test-zerith-rag"),
                    patch.object(rag, "CORPUS_DIR", corpus),
                    patch.object(rag, "CHUNK_SIZE", 100),
                    patch.object(rag, "CHUNK_OVERLAP", 20),
                    patch.object(rag, "EMBED_BATCH_SIZE", 2),
                    patch.object(
                        rag,
                        "_embed",
                        side_effect=lambda texts: [[1.0, 0.0, 0.0] for _ in texts],
                    ),
                ):
                    indexed = rag.index_corpus()
                    results = rag.retrieve_chunks("array boundary", top_k=2)

                    (corpus / "arrays.md").write_text(
                        "Only the updated note remains.",
                        encoding="utf-8",
                    )
                    refreshed = rag.index_corpus()
                    collection = client.get_collection("test-zerith-rag")

                self.assertGreater(indexed["chunks"], 1)
                self.assertTrue(results)
                self.assertEqual(results[0]["source"], "arrays.md")
                self.assertEqual(refreshed["chunks"], 1)
                self.assertEqual(refreshed["removed_stale_chunks"], indexed["chunks"] - 1)
                self.assertEqual(collection.points_count, 1)
            finally:
                client.close()


if __name__ == "__main__":
    unittest.main()
