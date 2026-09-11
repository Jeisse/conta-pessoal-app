from functools import lru_cache

import anthropic
from dotenv import load_dotenv

load_dotenv()

CATEGORIZE_MODEL = "claude-haiku-4-5"
QUERY_MODEL = "claude-sonnet-5"
PDF_EXTRACTION_MODEL = "claude-sonnet-5"


@lru_cache
def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic()
