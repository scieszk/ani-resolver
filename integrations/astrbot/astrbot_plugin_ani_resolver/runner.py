import asyncio
import inspect
import json
import os
import re
from collections.abc import Sequence


DEFAULT_EXECUTABLE = "/srv/ani-resolver/bin/ani-resolver"
MAX_INPUT_LENGTH = 10_000
MAX_OUTPUT_BYTES = 512_000
PROVIDER_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")
TAG_VALUE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
EXTERNAL_ID = re.compile(
    r"^(?:(?:bangumi|bgm|tmdb-tv|tmdb-movie|anilist):[0-9]+|wikidata:Q[1-9][0-9]*)$"
)


def build_provider_list_args() -> list[str]:
    return ["provider", "list", "--json"]


def build_parse_args(value: str) -> list[str]:
    return ["parse", _input(value), "--json"]


def build_inventory_args(value: str, *, full_files: bool = False) -> list[str]:
    args = ["inventory", _input(value)]
    if full_files:
        args.append("--full-files")
    args.append("--json")
    return args


def build_resolve_args(
    entity_type: str,
    value: str,
    *,
    providers: str,
    top: int = 5,
    work: str = "",
) -> list[str]:
    if entity_type not in {"work", "character"}:
        raise ValueError("entity type must be work or character")
    args = ["resolve", entity_type, _input(value), "--top", str(_top(top))]
    normalized_providers = _providers(providers)
    if not normalized_providers:
        raise ValueError("provider list must not be empty")
    args.extend(["--providers", normalized_providers])
    if work:
        if entity_type != "character":
            raise ValueError("work constraint is only valid for character resolution")
        args.extend(["--work", _external_id(work)])
    args.append("--json")
    return args


def build_resolve_character_args(
    *,
    providers: str,
    name: str = "",
    work: str = "",
    top: int = 5,
    hair_colors: str = "",
    eye_colors: str = "",
    hair_styles: str = "",
    genders: str = "",
    apparent_ages: str = "",
    clothing: str = "",
    traits: str = "",
) -> list[str]:
    args = ["resolve", "character"]
    normalized_name = name.strip()
    if normalized_name:
        args.extend(["--name", _input(normalized_name)])
    if work:
        args.extend(["--work", _external_id(work)])

    structured = (
        ("--hair-color", hair_colors, "hair color"),
        ("--eye-color", eye_colors, "eye color"),
        ("--hair-style", hair_styles, "hair style"),
        ("--gender", genders, "gender"),
        ("--apparent-age", apparent_ages, "apparent age"),
        ("--clothing", clothing, "clothing"),
        ("--trait", traits, "trait"),
    )
    has_appearance = False
    for option, value, label in structured:
        normalized = _tags(value, label)
        if not normalized:
            continue
        args.extend([option, normalized])
        has_appearance = True

    if not normalized_name and not work and not has_appearance:
        raise ValueError("character query requires a name, work, or appearance tag")

    normalized_providers = _providers(providers)
    if not normalized_providers:
        raise ValueError("provider list must not be empty")
    args.extend(["--top", str(_top(top)), "--providers", normalized_providers, "--json"])
    return args


def build_resolve_image_args(
    value: str,
    *,
    providers: str,
    top: int = 5,
    allow_local: bool = False,
) -> list[str]:
    args = [
        "resolve",
        "image",
        _image_input(value, allow_local=allow_local),
        "--top",
        str(_top(top)),
    ]
    normalized_providers = _providers(providers)
    if not normalized_providers:
        raise ValueError("image provider list must not be empty")
    args.extend(["--providers", normalized_providers])
    args.append("--json")
    return args


async def resolve_event_image_input(event) -> str | None:
    chain = list(event.get_messages() or [])
    reply_images = []
    current_images = []
    for segment in chain:
        if segment.__class__.__name__ == "Reply":
            reply_images.extend(getattr(segment, "chain", None) or [])
        elif segment.__class__.__name__ == "Image":
            current_images.append(segment)

    for segment in [*reply_images, *current_images]:
        value = await _image_component_input(segment)
        if value:
            return value
    return None


async def resolve_event_torrent_input(event) -> str | None:
    chain = list(event.get_messages() or [])
    reply_files = []
    current_files = []
    for segment in chain:
        if segment.__class__.__name__ == "Reply":
            reply_files.extend(getattr(segment, "chain", None) or [])
        elif segment.__class__.__name__ == "File":
            current_files.append(segment)

    for segment in [*reply_files, *current_files]:
        value = await _torrent_component_input(segment)
        if value:
            return value
    return None


async def _torrent_component_input(segment) -> str | None:
    if segment.__class__.__name__ != "File":
        return None
    name = getattr(segment, "name", "") or ""
    if name and not name.lower().endswith(".torrent"):
        return None
    getter = getattr(segment, "get_file", None)
    if not callable(getter):
        return None
    try:
        value = getter()
        if inspect.isawaitable(value):
            value = await value
    except Exception:
        return None
    if not isinstance(value, str) or not value or not os.path.isfile(value):
        return None
    if not (name.lower().endswith(".torrent") or value.lower().endswith(".torrent")):
        return None
    return value


async def _image_component_input(segment) -> str | None:
    if segment.__class__.__name__ != "Image":
        return None
    for attribute in ("file", "path"):
        value = getattr(segment, attribute, "")
        if isinstance(value, str) and value and os.path.isfile(value):
            return value

    converter = getattr(segment, "convert_to_file_path", None)
    if callable(converter):
        try:
            converted = converter()
            if inspect.isawaitable(converted):
                converted = await converted
            if isinstance(converted, str) and converted:
                if os.path.isfile(converted) or converted.startswith(("http://", "https://")):
                    return converted
        except Exception:
            pass

    for attribute in ("url", "file"):
        value = getattr(segment, attribute, "")
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    return None


def build_entity_get_args(entity_type: str, external_id: str, provider: str = "") -> list[str]:
    if entity_type not in {"work", "character"}:
        raise ValueError("entity type must be work or character")
    args = ["entity", "get", entity_type, _external_id(external_id)]
    if provider:
        args.extend(["--provider", _provider(provider)])
    args.append("--json")
    return args


def build_entity_relations_args(
    entity_type: str,
    external_ids: str,
    *,
    providers: str,
) -> list[str]:
    if entity_type not in {"work", "character"}:
        raise ValueError("entity type must be work or character")
    ids = _external_ids(external_ids)
    normalized_providers = _providers(providers)
    if not normalized_providers:
        raise ValueError("provider list must not be empty")
    return [
        "entity",
        "relations",
        entity_type,
        *ids,
        "--providers",
        normalized_providers,
        "--json",
    ]


def build_work_characters_args(external_id: str, provider: str = "") -> list[str]:
    args = ["work", "characters", _external_id(external_id)]
    if provider:
        args.extend(["--provider", _provider(provider)])
    args.append("--json")
    return args


class AniResolverRunner:
    def __init__(self, executable: str | None = None, timeout_seconds: float = 45.0):
        self.executable = executable or os.environ.get("ANI_RESOLVER_CLI", DEFAULT_EXECUTABLE)
        self.timeout_seconds = timeout_seconds

    async def invoke(self, args: Sequence[str]) -> str:
        process = await asyncio.create_subprocess_exec(
            self.executable,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=self.timeout_seconds,
            )
        except TimeoutError:
            process.kill()
            await process.wait()
            return _error("timeout", f"ani-resolver exceeded {self.timeout_seconds:g} seconds")

        if len(stdout) > MAX_OUTPUT_BYTES or len(stderr) > MAX_OUTPUT_BYTES:
            return _error("output_too_large", "ani-resolver output exceeded the plugin limit")

        payload = stdout if process.returncode == 0 else stderr or stdout
        text = payload.decode("utf-8", errors="replace").strip()
        if not text:
            return _error("empty_output", f"ani-resolver exited with code {process.returncode}")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return _error("invalid_json", "ani-resolver returned invalid JSON")
        return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))


def _input(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("input must not be empty")
    if len(normalized) > MAX_INPUT_LENGTH:
        raise ValueError(f"input must not exceed {MAX_INPUT_LENGTH} characters")
    return normalized


def _image_input(value: str, *, allow_local: bool) -> str:
    normalized = _input(value)
    if allow_local or normalized.lower().startswith(("http://", "https://")):
        return normalized
    raise ValueError("explicit image input must be an HTTP(S) URL")


def _top(value: int) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("top must be an integer") from error
    if not 1 <= normalized <= 20:
        raise ValueError("top must be between 1 and 20")
    return normalized


def _providers(value: str) -> str:
    if not value.strip():
        return ""
    providers = [item.strip() for item in value.split(",") if item.strip()]
    if not providers or len(providers) > 10:
        raise ValueError("provider list must contain between 1 and 10 IDs")
    return ",".join(dict.fromkeys(_provider(item) for item in providers))


def _provider(value: str) -> str:
    normalized = value.strip()
    if not PROVIDER_ID.fullmatch(normalized):
        raise ValueError(f"invalid provider ID: {normalized}")
    return normalized


def _tags(value: str, label: str) -> str:
    if not value.strip():
        return ""
    values = [item.strip().lower() for item in value.split(",") if item.strip()]
    if not values or len(values) > 20:
        raise ValueError(f"{label} tag list must contain between 1 and 20 values")
    for item in values:
        if len(item) > 64 or not TAG_VALUE.fullmatch(item):
            raise ValueError(f"invalid {label} tag: {item}")
    return ",".join(dict.fromkeys(values))


def _external_id(value: str) -> str:
    normalized = value.strip()
    if not EXTERNAL_ID.fullmatch(normalized):
        raise ValueError(f"invalid external ID: {normalized}")
    return normalized


def _external_ids(value: str) -> list[str]:
    values = [item.strip() for item in value.split(",") if item.strip()]
    if not values or len(values) > 20:
        raise ValueError("external ID list must contain between 1 and 20 IDs")
    return list(dict.fromkeys(_external_id(item) for item in values))


def _error(code: str, message: str) -> str:
    return json.dumps(
        {"schemaVersion": "ani-resolver.astrbot-error.v1", "error": {"code": code, "message": message}},
        ensure_ascii=False,
        separators=(",", ":"),
    )
