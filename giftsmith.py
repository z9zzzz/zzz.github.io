"""
Telegram Collectible Gift Scraper
----------------------------------
Fetches a Telegram NFT gift page, downloads its .tgs sticker, converts it
to .json (Lottie format) inside GiftsJson/, and updates gifts-manifest.json.
No tgs folder, no HTML editing.
"""

from __future__ import annotations

import gzip
import json
import logging
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("gift_scraper")


@dataclass
class GiftInfo:
    """Metadata extracted from a Telegram gift page."""

    link: str
    sticker_url: str
    clean_name: str
    title: Optional[str]
    slug: Optional[str]
    number: Optional[str]

    @property
    def label_text(self) -> str:
        return self.title if self.title else self.clean_name


class TelegramGiftFetcher:
    """Fetches and parses Telegram collectible gift pages."""

    STICKER_PATTERN = re.compile(
        r'type="application/x-tgsticker"\s+srcset="([^"]+)"'
    )
    TITLE_PATTERN = re.compile(r'<meta property="og:title" content="([^"]+)"')
    SLUG_PATTERN = re.compile(r"/nft/([^/?#]+)")
    NUMBER_PATTERN = re.compile(r"#(\d+)")
    TRAILING_NUMBER_PATTERN = re.compile(r"-(\d+)$")

    def __init__(self, timeout: int = 20):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36"
                )
            }
        )

    def fetch(self, link: str) -> GiftInfo:
        response = self.session.get(link, timeout=self.timeout)
        response.raise_for_status()
        html = response.text

        sticker_match = self.STICKER_PATTERN.search(html)
        if not sticker_match:
            raise ValueError(f"No .tgs sticker found on page: {link}")
        sticker_url = sticker_match.group(1)

        title_match = self.TITLE_PATTERN.search(html)
        title = title_match.group(1) if title_match else None

        slug_match = self.SLUG_PATTERN.search(link)
        slug = slug_match.group(1) if slug_match else None

        clean_name = self._build_clean_name(title, slug)
        number = self._extract_number(title, slug)

        return GiftInfo(
            link=link,
            sticker_url=sticker_url,
            clean_name=clean_name,
            title=title,
            slug=slug,
            number=number,
        )

    def _build_clean_name(self, title: Optional[str], slug: Optional[str]) -> str:
        if title:
            name_part = re.sub(r"\s*#\d+$", "", title).strip()
            return name_part.replace(" ", "")
        if slug:
            return self.TRAILING_NUMBER_PATTERN.sub("", slug)
        return "gift"

    def _extract_number(self, title: Optional[str], slug: Optional[str]) -> Optional[str]:
        if title:
            match = self.NUMBER_PATTERN.search(title)
            if match:
                return match.group(1)
        if slug:
            match = self.TRAILING_NUMBER_PATTERN.search(slug)
            if match:
                return match.group(1)
        return None


class GiftAssetConverter:
    """Downloads .tgs stickers and converts them directly to Lottie .json."""

    def __init__(self, json_dir: str = "GiftsJson", timeout: int = 30):
        self.json_dir = Path(json_dir)
        self.timeout = timeout
        self.session = requests.Session()
        self.json_dir.mkdir(parents=True, exist_ok=True)

    def process(self, sticker_url: str, clean_name: str) -> Path:
        """Download .tgs and convert to .json in memory — no tgs file saved."""
        logger.info("Downloading sticker: %s", sticker_url)
        response = self.session.get(sticker_url, timeout=self.timeout)
        response.raise_for_status()

        # .tgs is a gzip-compressed Lottie JSON
        raw = gzip.decompress(response.content)
        data = json.loads(raw)

        json_path = self.json_dir / f"{clean_name}.json"
        json_path.write_text(json.dumps(data), encoding="utf-8")
        logger.info("Saved Lottie JSON: %s", json_path)
        return json_path


class GiftManifestUpdater:
    """Adds or updates a gift entry in gifts-manifest.json."""

    def __init__(self, manifest_path: str = "GiftsJson/gifts-manifest.json"):
        self.manifest_path = Path(manifest_path)

    def update(self, gift: GiftInfo, json_path: Path) -> None:
        # Load existing manifest or start fresh
        if self.manifest_path.exists():
            gifts: list[dict] = json.loads(
                self.manifest_path.read_text(encoding="utf-8")
            )
        else:
            gifts = []

        json_rel = json_path.as_posix()
        number_int = int(gift.number) if gift.number else None

        # Build the new entry
        new_entry = {
            "id": self._next_id(gifts),
            "name": re.sub(r"\s*#\d+$", "", gift.label_text).strip(),
            "number": number_int,
            "label": gift.label_text,
            "json": json_rel,
            "link": gift.link,
        }

        # If a gift with the same link already exists → update it, don't duplicate
        existing_index = next(
            (i for i, g in enumerate(gifts) if g.get("link") == gift.link), None
        )
        if existing_index is not None:
            new_entry["id"] = gifts[existing_index]["id"]
            gifts[existing_index] = new_entry
            logger.info("Updated existing gift in manifest: %s", gift.label_text)
        else:
            gifts.append(new_entry)
            logger.info("Added new gift to manifest: %s", gift.label_text)

        self.manifest_path.write_text(
            json.dumps(gifts, indent=5, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("Manifest saved: %s", self.manifest_path)

    def _next_id(self, gifts: list[dict]) -> int:
        return max((g.get("id", 0) for g in gifts), default=0) + 1


class GiftPipeline:
    """Orchestrates fetching, converting, and manifest updating."""

    def __init__(self, manifest_path: str = "GiftsJson/gifts-manifest.json"):
        self.fetcher = TelegramGiftFetcher()
        self.converter = GiftAssetConverter()
        self.manifest_updater = GiftManifestUpdater(manifest_path)

    def run(self, link: str) -> GiftInfo:
        logger.info("Fetching gift page: %s", link)
        gift = self.fetcher.fetch(link)

        logger.info("Converting sticker for: %s", gift.clean_name)
        json_path = self.converter.process(gift.sticker_url, gift.clean_name)

        self.manifest_updater.update(gift, json_path)
        return gift


def main() -> None:
    link = input("Enter Gift link: ").strip()
    pipeline = GiftPipeline()
    try:
        gift = pipeline.run(link)
        logger.info("Done: %s", gift.label_text)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()