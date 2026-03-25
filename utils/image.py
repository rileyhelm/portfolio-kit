from __future__ import annotations

import io
from typing import BinaryIO

from PIL import Image


MAX_IMAGE_WIDTH = 2200
MAX_IMAGE_HEIGHT = 2200
WEBP_QUALITY = 82


def process_image(
    file_data: BinaryIO,
    *,
    max_width: int = MAX_IMAGE_WIDTH,
    max_height: int = MAX_IMAGE_HEIGHT,
    quality: int = WEBP_QUALITY,
) -> tuple[io.BytesIO, str]:
    try:
        image = Image.open(file_data)
    except Exception as exc:  # pragma: no cover - pillow error formatting varies
        raise ValueError(f"Failed to open image: {exc}") from exc

    if image.mode in {"RGBA", "LA", "P"}:
        background = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode == "P":
            image = image.convert("RGBA")
        background.paste(image, mask=image.split()[-1] if image.mode == "RGBA" else None)
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    width, height = image.size
    if width > max_width or height > max_height:
        ratio = min(max_width / width, max_height / height)
        image = image.resize(
            (int(width * ratio), int(height * ratio)),
            Image.Resampling.LANCZOS,
        )

    output = io.BytesIO()
    image.save(output, format="WEBP", quality=quality, method=6)
    output.seek(0)
    return output, "image/webp"

