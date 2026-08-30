import ast
import asyncio
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


PLUGIN_ROOT = Path(__file__).parents[1] / "astrbot_plugin_ani_resolver"
RUNNER_PATH = PLUGIN_ROOT / "runner.py"
MAIN_PATH = PLUGIN_ROOT / "main.py"
SKILL_PATH = PLUGIN_ROOT / "skills" / "resolve-anime-content" / "SKILL.md"
METADATA_PATH = PLUGIN_ROOT / "metadata.yaml"
ROOT_SKILL_PATH = Path(__file__).parents[3] / "skills" / "resolve-anime-content" / "SKILL.md"


def load_runner_module():
    spec = importlib.util.spec_from_file_location("ani_resolver_runner", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load runner module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class CommandBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runner = load_runner_module()

    def test_resolve_input_stays_one_argv_value(self):
        args = self.runner.build_resolve_args(
            "work",
            '迷宫饭"; touch /tmp/should-not-exist',
            top=5,
            providers="bangumi,tmdb,bangumi-archive",
        )

        self.assertEqual(args[:3], ["resolve", "work", '迷宫饭"; touch /tmp/should-not-exist'])
        self.assertEqual(args[-1], "--json")

    def test_inventory_input_stays_one_argv_value_and_is_bounded_by_default(self):
        args = self.runner.build_inventory_args(
            "/media/Anime/Dungeon Meshi [01-24]",
        )

        self.assertEqual(
            args,
            ["inventory", "/media/Anime/Dungeon Meshi [01-24]", "--json"],
        )
        self.assertEqual(
            self.runner.build_inventory_args("/media/Anime", full_files=True),
            ["inventory", "/media/Anime", "--full-files", "--json"],
        )

    def test_provider_ids_reject_shell_syntax(self):
        with self.assertRaisesRegex(ValueError, "provider"):
            self.runner.build_resolve_args(
                "work",
                "迷宫饭",
                top=5,
                providers="bangumi;touch-/tmp/x",
            )

    def test_text_builder_rejects_empty_providers(self):
        with self.assertRaisesRegex(ValueError, "provider"):
            self.runner.build_resolve_args(
                "work",
                "迷宫饭",
                providers="",
            )

    def test_character_work_id_is_validated(self):
        args = self.runner.build_resolve_character_args(
            name="艾拉",
            top=5,
            providers="bangumi-archive",
            work="bangumi:400602",
            hair_colors="white,silver",
            hair_styles="twintails",
            genders="female",
            traits="expressionless",
        )
        self.assertIn("bangumi:400602", args)
        self.assertIn("--name", args)
        self.assertIn("--hair-color", args)
        self.assertIn("white,silver", args)
        self.assertNotIn("白发 双马尾", args)

        with self.assertRaisesRegex(ValueError, "external ID"):
            self.runner.build_resolve_character_args(
                name="艾拉",
                top=5,
                providers="bangumi-archive",
                work="bangumi:400602;id",
            )

    def test_character_builder_requires_a_structured_condition(self):
        with self.assertRaisesRegex(ValueError, "name, work, or appearance"):
            self.runner.build_resolve_character_args(providers="wikidata")

        with self.assertRaisesRegex(ValueError, "tag"):
            self.runner.build_resolve_character_args(
                providers="wikidata",
                hair_colors="white;touch-/tmp/x",
            )

    def test_anilist_and_wikidata_ids_are_validated(self):
        self.assertIn(
            "anilist:176754",
            self.runner.build_entity_get_args("character", "anilist:176754"),
        )
        self.assertIn(
            "wikidata:Q104144455",
            self.runner.build_entity_get_args("character", "wikidata:Q104144455"),
        )

        with self.assertRaisesRegex(ValueError, "external ID"):
            self.runner.build_entity_get_args(
                "character",
                "wikidata:Q1;touch-/tmp/x",
            )

    def test_entity_relations_builder_validates_multiple_ids_and_providers(self):
        args = self.runner.build_entity_relations_args(
            "work",
            "bangumi:400602,anilist:154587",
            providers="bangumi,anilist",
        )

        self.assertEqual(
            args,
            [
                "entity",
                "relations",
                "work",
                "bangumi:400602",
                "anilist:154587",
                "--providers",
                "bangumi,anilist",
                "--json",
            ],
        )
        with self.assertRaisesRegex(ValueError, "external ID"):
            self.runner.build_entity_relations_args(
                "work",
                "bangumi:400602;touch-/tmp/x",
                providers="bangumi",
            )

    def test_top_is_bounded(self):
        with self.assertRaisesRegex(ValueError, "top"):
            self.runner.build_resolve_args("work", "迷宫饭", top=51, providers="")

    def test_image_input_stays_one_argv_value(self):
        args = self.runner.build_resolve_image_args(
            'https://example.test/frame.jpg?name="quoted"',
            top=3,
            providers="trace-moe,animetrace,saucenao",
        )

        self.assertEqual(
            args[:3],
            ["resolve", "image", 'https://example.test/frame.jpg?name="quoted"'],
        )
        self.assertEqual(args[-1], "--json")

    def test_image_builder_rejects_explicit_local_paths_and_empty_providers(self):
        with self.assertRaisesRegex(ValueError, "HTTP"):
            self.runner.build_resolve_image_args(
                "/AstrBot/data/private/avatar.jpg",
                providers="trace-moe",
            )

        attachment_args = self.runner.build_resolve_image_args(
            "/AstrBot/data/temp/message-image.jpg",
            providers="animetrace",
            allow_local=True,
        )
        self.assertEqual(
            attachment_args[:3],
            ["resolve", "image", "/AstrBot/data/temp/message-image.jpg"],
        )

        with self.assertRaisesRegex(ValueError, "provider"):
            self.runner.build_resolve_image_args(
                "https://example.test/frame.jpg",
                providers=",",
            )

    def test_image_input_can_be_taken_from_a_replied_or_current_message(self):
        class Image:
            def __init__(self, *, url="", file=""):
                self.url = url
                self.file = file

        class Reply:
            def __init__(self, chain):
                self.chain = chain

        class Event:
            def __init__(self, chain):
                self.chain = chain

            def get_messages(self):
                return self.chain

        replied = Image(url="https://example.test/replied.jpg")
        current = Image(url="https://example.test/current.jpg")

        self.assertEqual(
            asyncio.run(
                self.runner.resolve_event_image_input(Event([Reply([replied]), current]))
            ),
            "https://example.test/replied.jpg",
        )
        self.assertEqual(
            asyncio.run(self.runner.resolve_event_image_input(Event([current]))),
            "https://example.test/current.jpg",
        )
        self.assertIsNone(
            asyncio.run(self.runner.resolve_event_image_input(Event([]))),
        )

    def test_torrent_input_can_be_taken_from_a_replied_or_current_file(self):
        class File:
            def __init__(self, name, file_path):
                self.name = name
                self.file_path = file_path
                self.calls = 0

            async def get_file(self):
                self.calls += 1
                return self.file_path

        class Reply:
            def __init__(self, chain):
                self.chain = chain

        class Event:
            def __init__(self, chain):
                self.chain = chain

            def get_messages(self):
                return self.chain

        with tempfile.TemporaryDirectory() as temporary:
            replied_path = Path(temporary) / "replied.torrent"
            current_path = Path(temporary) / "current.torrent"
            text_path = Path(temporary) / "notes.txt"
            replied_path.write_bytes(b"torrent")
            current_path.write_bytes(b"torrent")
            text_path.write_text("notes", encoding="utf-8")

            self.assertEqual(
                asyncio.run(
                    self.runner.resolve_event_torrent_input(
                        Event([
                            Reply([File("replied.torrent", str(replied_path))]),
                            File("current.torrent", str(current_path)),
                        ])
                    )
                ),
                str(replied_path),
            )
            non_torrent = File("notes.txt", str(text_path))
            self.assertIsNone(
                asyncio.run(
                    self.runner.resolve_event_torrent_input(
                        Event([non_torrent])
                    )
                )
            )
            self.assertEqual(non_torrent.calls, 0)


class PluginContractTests(unittest.TestCase):
    def test_plugin_metadata_matches_registered_version(self):
        tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8"))
        register = next(
            decorator
            for node in ast.walk(tree)
            if isinstance(node, ast.ClassDef)
            for decorator in node.decorator_list
            if isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Name)
            and decorator.func.id == "register"
        )
        registered_version = ast.literal_eval(register.args[3])
        metadata_version = next(
            line.split(":", 1)[1].strip()
            for line in METADATA_PATH.read_text(encoding="utf-8").splitlines()
            if line.startswith("version:")
        )

        self.assertEqual(metadata_version, registered_version)

    def test_every_tool_parameter_has_an_astrbot_docstring_schema(self):
        tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8"))
        tools = []
        for node in ast.walk(tree):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            names = {
                decorator.func.attr
                for decorator in node.decorator_list
                if isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
            }
            if "llm_tool" not in names:
                continue
            tools.append(node)
            parameters = [arg.arg for arg in node.args.args if arg.arg not in {"self", "event"}]
            docstring = ast.get_docstring(node) or ""
            if parameters:
                self.assertIn("Args:", docstring, node.name)
            for parameter in parameters:
                self.assertRegex(docstring, rf"(?m)^\s*{parameter}\((?:string|number|boolean|object|array(?:\[\w+\])?)\):")

        self.assertEqual(
            {tool.name for tool in tools},
            {
                "provider_list",
                "parse_content",
                "inventory_content",
                "resolve_work",
                "resolve_character",
                "resolve_image",
                "entity_get",
                "entity_relations",
                "work_characters",
            },
        )

    def test_image_tool_allows_the_message_attachment_to_supply_input(self):
        tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8"))
        tool = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "resolve_image"
        )
        input_index = [arg.arg for arg in tool.args.args].index("input")
        first_default_index = len(tool.args.args) - len(tool.args.defaults)

        self.assertGreaterEqual(input_index, first_default_index)
        self.assertEqual(
            ast.literal_eval(tool.args.defaults[input_index - first_default_index]),
            "",
        )
        providers_index = [arg.arg for arg in tool.args.args].index("providers")
        self.assertLess(providers_index, first_default_index)

    def test_content_tools_allow_a_torrent_attachment_to_supply_input(self):
        tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8"))
        for tool_name in ("parse_content", "inventory_content", "resolve_work"):
            tool = next(
                node
                for node in ast.walk(tree)
                if isinstance(node, ast.AsyncFunctionDef) and node.name == tool_name
            )
            input_index = [arg.arg for arg in tool.args.args].index("input")
            first_default_index = len(tool.args.args) - len(tool.args.defaults)
            self.assertGreaterEqual(input_index, first_default_index, tool_name)
            self.assertEqual(
                ast.literal_eval(tool.args.defaults[input_index - first_default_index]),
                "",
                tool_name,
            )

    def test_text_resolve_tools_require_provider_selection(self):
        tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8"))
        for tool_name in ("resolve_work", "resolve_character"):
            tool = next(
                node
                for node in ast.walk(tree)
                if isinstance(node, ast.AsyncFunctionDef) and node.name == tool_name
            )
            providers_index = [arg.arg for arg in tool.args.args].index("providers")
            first_default_index = len(tool.args.args) - len(tool.args.defaults)
            self.assertLess(providers_index, first_default_index)
            self.assertNotIn("留空使用全部", ast.get_docstring(tool) or "")

    def test_character_tool_exposes_structured_fields(self):
        tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8"))
        tool = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "resolve_character"
        )
        parameters = {arg.arg for arg in tool.args.args}
        self.assertTrue(
            {
                "name",
                "work",
                "hair_colors",
                "eye_colors",
                "hair_styles",
                "genders",
                "apparent_ages",
                "clothing",
                "traits",
            }.issubset(parameters)
        )
        self.assertNotIn("input", parameters)

    def test_skill_routes_to_native_astrbot_tools(self):
        skill = SKILL_PATH.read_text(encoding="utf-8")
        for tool_name in (
            "ani_resolver_provider_list",
            "ani_resolver_parse",
            "ani_resolver_inventory",
            "ani_resolver_resolve_work",
            "ani_resolver_resolve_character",
            "ani_resolver_resolve_image",
            "ani_resolver_entity_get",
            "ani_resolver_entity_relations",
            "ani_resolver_work_characters",
        ):
            self.assertIn(tool_name, skill)

        for guidance in (
            "character_appearance_search",
            "Wikidata",
            "facts.appearance",
            "anilist:<id>",
            "anime_scene_lookup",
            "reverse_image_lookup",
            "character_image_lookup",
        ):
            self.assertIn(guidance, skill)

    def test_bundled_skill_routes_image_intents_and_preserves_native_confidence(self):
        skill = ROOT_SKILL_PATH.read_text(encoding="utf-8")

        for guidance in (
            "resolve image",
            "inventory",
            "outcome",
            "entity relations",
            "source-to-destination",
            "trace.moe",
            "SauceNAO",
            "AnimeTrace",
            "anime_scene_lookup",
            "reverse_image_lookup",
            "character_image_lookup",
            "notConfident",
            "third-party",
        ):
            self.assertIn(guidance, skill)


if __name__ == "__main__":
    unittest.main()
