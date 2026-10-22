import json
import logging
import time

import requests

import config
from database import get_cache, make_hash, set_cache

log = logging.getLogger(__name__)

_SYSTEM_EXPERT = (
    "You are a Pokémon GO expert in raids, PvP, evolution, rarity and resource planning. "
    "Respond in English. Use concrete names and numbers, with at most six sentences per section."
)
_SYSTEM_TACTICIAN = (
    "You are a Pokémon GO tactical advisor. Respond in English with practical, personalized "
    "event and battle plans. Use concise bullet points and explain what to do and when."
)


def build_pokemon_prompt(p: dict, tier_data: dict, top_items: list[str]) -> str:
    return f"""Analyze this Pokémon from my account. Respond in English.
Pokémon: {json.dumps(p, ensure_ascii=False)}
Meta tiers: {json.dumps(tier_data, ensure_ascii=False)}
Inventory: {', '.join(top_items) or 'No inventory data'}
Use sections: Value; Raid and PvP roles; Evolve, power up, purify or keep;
Recommended moves and TMs; Resource priorities. State any uncertainty."""


def build_items_prompt(items: list[dict], top_pokes: list[dict]) -> str:
    return f"""Analyze my Pokémon GO inventory and recommend how to use it. Respond in English.
Inventory: {json.dumps(items, ensure_ascii=False)}
Best Pokémon: {json.dumps(top_pokes, ensure_ascii=False)}
Use sections: Elite TMs; Evolution items; Items to discard; Resource collection priorities.
Recommend specific Pokémon and quantities based only on the supplied data."""


def build_event_prompt(event: dict, relevant_pokes: list[dict], items: list[dict]) -> str:
    return f"""Plan this Pokémon GO event for my account. Respond in English.
Event: {json.dumps(event, ensure_ascii=False)}
Relevant Pokémon: {json.dumps(relevant_pokes, ensure_ascii=False)}
Inventory: {json.dumps(items, ensure_ascii=False)}
Use sections: Summary; Top three priorities; Pokémon to keep, evolve or power up;
Items to use and when; Pitfalls. Distinguish supplied facts from estimates."""


def build_pvp_teams_prompt(league: str, candidates: list[dict]) -> str:
    return f"""Recommend two or three Pokémon GO PvP teams for {league}. Respond in English.
Available candidates: {json.dumps(candidates, ensure_ascii=False)}
For each team identify Lead, Safe Switch and Closer, type synergy, shield strategy,
and weaknesses. Then explain missing meta Pokémon, IV investment priorities, and
recommended Fast and Charged moves, including when Elite TMs are required.
Use only available candidates for the recommended teams."""


# ── AI providers ──────────────────────────────────────────────────────────────

_gemini_model_cache: list = [0.0, []]  # [timestamp, model_ids]


def _gemini_models() -> list[str]:
    if _gemini_model_cache[1] and time.time() - _gemini_model_cache[0] < 3600:
        return _gemini_model_cache[1]
    try:
        r = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": config.GEMINI_API_KEY}, timeout=10,
        )
        r.raise_for_status()
        available = []
        for m in r.json().get("models", []):
            name    = m.get("name", "")
            name    = name[7:] if name.startswith("models/") else name
            methods = m.get("supportedGenerationMethods", [])
            if "generateContent" in methods and "flash" in name and "gemini" in name:
                available.append(name)
        available.sort(key=lambda n: (
            0 if "2.5" in n else 1 if "2.0" in n else 2 if "1.5" in n else 3, n
        ))
        if available:
            _gemini_model_cache[:] = [time.time(), available]
            log.info("Gemini models: %s", available)
            return available
    except Exception as exc:
        log.warning("Gemini model list failed: %s", exc)
    fallback = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"]
    _gemini_model_cache[:] = [time.time(), fallback]
    return fallback


def _gemini(prompt: str, system: str) -> str:
    if not config.GEMINI_API_KEY:
        raise ValueError("Set GEMINI_API_KEY in .env")
    full_prompt = f"{system}\n\n{prompt}" if system else prompt
    payload = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"maxOutputTokens": 2000, "temperature": 0.7},
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
        ],
    }
    errors: list[str] = []
    for model in _gemini_models():
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={config.GEMINI_API_KEY}"
        )
        for attempt in range(2):
            try:
                r = requests.post(url, json=payload, timeout=40)
                if r.status_code == 404:
                    errors.append(f"404 {model}")
                    _gemini_model_cache[:] = [0.0, []]
                    break
                if r.status_code == 429:
                    if attempt == 0:
                        log.warning("Gemini 429 on %s — retry in 5s…", model)
                        time.sleep(5)
                        continue
                    errors.append(f"429 {model}")
                    break
                r.raise_for_status()
                log.info("Gemini OK: %s", model)
                return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            except requests.exceptions.HTTPError as e:
                code = e.response.status_code if e.response is not None else 0
                if code == 429 and attempt == 0:
                    time.sleep(5)
                    continue
                errors.append(f"{code} {model}")
                break
            except (KeyError, IndexError):
                raise ValueError(f"Unexpected Gemini response: {r.text[:300]}")
    raise ValueError(
        f"Gemini unavailable: {'; '.join(errors)}. "
        "Check your API key and provider rate limits. "
        "Previously generated responses remain cached."
    )


def _openai(prompt: str, system: str) -> str:
    if not config.OPENAI_API_KEY:
        raise ValueError("Set OPENAI_API_KEY in .env")
    r = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {config.OPENAI_API_KEY}", "Content-Type": "application/json"},
        json={
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system or "You are a Pokémon GO expert. Respond in English."},
                {"role": "user",   "content": prompt},
            ],
            "max_tokens": 2000,
            "temperature": 0.7,
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def _azure(prompt: str, system: str) -> str:
    if not config.AZURE_API_KEY or not config.AZURE_ENDPOINT:
        raise ValueError("Set AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT in .env")
    url = (
        f"{config.AZURE_ENDPOINT.rstrip('/')}/openai/deployments/"
        f"{config.AZURE_DEPLOYMENT}/chat/completions?api-version={config.AZURE_API_VERSION}"
    )
    r = requests.post(
        url,
        headers={"api-key": config.AZURE_API_KEY, "Content-Type": "application/json"},
        json={
            "messages": [
                {"role": "system", "content": system or "You are a Pokémon GO expert. Respond in English."},
                {"role": "user",   "content": prompt},
            ],
            "max_tokens": 2000,
            "temperature": 0.7,
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def _anthropic(prompt: str, system: str) -> str:
    if not config.ANTHROPIC_API_KEY:
        raise ValueError("Set ANTHROPIC_API_KEY in .env")
    r = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": config.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": "claude-3-5-sonnet-latest",
            "max_tokens": 2000,
            "system": system or "You are a Pokémon GO expert. Respond in English.",
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["content"][0]["text"].strip()


def call_ai(prompt: str, system: str = "") -> str:
    provider = config.AI_PROVIDER.lower()
    if provider == "gemini":
        return _gemini(prompt, system)
    if provider == "anthropic":
        return _anthropic(prompt, system)
    if provider == "azure":
        return _azure(prompt, system)
    return _openai(prompt, system)
