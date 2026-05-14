import pytest
from pathlib import Path
from PIL import Image

import main


class TestIterImages:
    def test_skips_non_image_files(self, tmp_path: Path):
        (tmp_path / "a.txt").write_text("hello")
        (tmp_path / "b.jpg").write_text("fake")
        results = list(main.iter_images(tmp_path))
        assert len(results) == 1
        assert results[0].name == "b.jpg"

    def test_excludes_output_dir(self, tmp_path: Path):
        out = tmp_path / "output"
        out.mkdir()
        (out / "a.jpg").write_text("fake")
        results = list(main.iter_images(tmp_path, out))
        assert len(results) == 0


class TestSafeStem:
    def test_cleans_special_chars(self, tmp_path: Path):
        p = tmp_path / "hello world/你好.jpg"
        stem = main.safe_stem(p, tmp_path)
        assert " " not in stem
        assert "hello" in stem


class TestIsLongImage:
    def test_detects_long_image(self):
        img = Image.new("RGB", (100, 200))
        assert main.is_long_image(img, 1.5) is True

    def test_rejects_normal_ratio(self):
        img = Image.new("RGB", (100, 100))
        assert main.is_long_image(img, 1.5) is False


class TestSeamBoundaries:
    def test_splits_by_height_when_no_seams(self):
        img = Image.new("RGB", (100, 400), color=(128, 128, 128))
        boundaries = main.seam_boundaries(img, ratio=1.5, sensitivity=1.5)
        assert len(boundaries) >= 1


class TestCropAroundFace:
    def test_crops_to_expected_size(self):
        img = Image.new("RGB", (2000, 2000), color=(100, 100, 100))
        box = (900, 900, 1100, 1100)  # 200x200 face
        cropped, complete, padded, resized = main.crop_around_face(img, box, 0.45)
        assert cropped.size == (main.CROP_SIZE, main.CROP_SIZE)
        assert complete is True

    def test_pads_when_face_near_edge(self):
        img = Image.new("RGB", (500, 500), color=(100, 100, 100))
        box = (10, 10, 60, 60)
        cropped, complete, padded, resized = main.crop_around_face(img, box, 0.45)
        assert padded is True
        assert cropped.size == (main.CROP_SIZE, main.CROP_SIZE)


class TestPaintFaces:
    def test_paints_rectangles(self):
        img = Image.new("RGB", (200, 200), color=(255, 255, 255))
        boxes = [(50, 50, 100, 100)]
        painted = main.paint_faces(img, boxes)
        assert painted.size == (200, 200)
        # Check that center of box area is not white anymore
        px = painted.getpixel((75, 75))
        assert px != (255, 255, 255)


class TestStats:
    def test_add_updates_fields(self):
        s = main.Stats(scanned=5, processed=3)
        s2 = s.add(scanned=1, processed=1)
        assert s2.scanned == 6
        assert s2.processed == 4
        # Original should be immutable
        assert s.scanned == 5
