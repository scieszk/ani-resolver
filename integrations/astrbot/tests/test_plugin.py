import ast
import importlib.util
from pathlib import Path
import sys
import unittest


PLUGIN_ROOT = Path(__file__).parents[1] / "astrbot_plugin_ani_resolver"
RUNNER_PATH = PLUGIN_ROOT / "runner.py"
MAIN_PATH = PLUGIN_ROOT / "main.py"
SKILL_PATH = PLUGIN_ROOT / "skills" / "resolve-anime-content" / "SKILL.md"
METADATA_PATH = PLUGIN_ROOT / "metadata.yaml"


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

    def test_provider_ids_reject_shell_syntax(self):
        with self.assertRaisesRegex(ValueError, "provider"):
            self.runner.build_resolve_args(
                "work",
                "迷宫饭",
                top=5,
                providers="bangumi;touch-/tmp/x",
            )

    def test_character_work_id_is_validated(self):
        args = self.runner.build_resolve_args(
            "character",
            "白发 双马尾",
            top=5,
            providers="bangumi-archive",
            work="bangumi:400602",
        )
        self.assertIn("bangumi:400602", args)

        with self.assertRaisesRegex(ValueError, "external ID"):
            self.runner.build_resolve_args(
                "character",
                "白发 双马尾",
                top=5,
                providers="bangumi-archive",
                work="bangumi:400602;id",
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

    def test_top_is_bounded(self):
        with self.assertRaisesRegex(ValueError, "top"):
            self.runner.build_resolve_args("work", "迷宫饭", top=51, providers="")


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
                "resolve_work",
                "resolve_character",
                "entity_get",
                "work_characters",
            },
        )

    def test_skill_routes_to_native_astrbot_tools(self):
        skill = SKILL_PATH.read_text(encoding="utf-8")
        for tool_name in (
            "ani_resolver_provider_list",
            "ani_resolver_parse",
            "ani_resolver_resolve_work",
            "ani_resolver_resolve_character",
            "ani_resolver_entity_get",
            "ani_resolver_work_characters",
        ):
            self.assertIn(tool_name, skill)

        for guidance in (
            "character_appearance_search",
            "Wikidata",
            "facts.appearance",
            "anilist:<id>",
        ):
            self.assertIn(guidance, skill)


if __name__ == "__main__":
    unittest.main()
