import json
from collections.abc import Callable

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register

from .runner import (
    AniResolverRunner,
    build_entity_get_args,
    build_parse_args,
    build_provider_list_args,
    build_resolve_args,
    build_work_characters_args,
)


@register(
    "astrbot_plugin_ani_resolver",
    "scieszk",
    "为 AstrBot 提供动画作品、角色和外部 ID 的多源识别工具",
    "0.2.0",
)
class AniResolverPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)
        self.runner = AniResolverRunner()

    async def _invoke(self, args: list[str]) -> str:
        try:
            return await self.runner.invoke(args)
        except FileNotFoundError:
            logger.error("ani-resolver CLI is not mounted at the configured path")
            return '{"schemaVersion":"ani-resolver.astrbot-error.v1","error":{"code":"cli_unavailable","message":"ani-resolver CLI is unavailable"}}'
        except Exception as error:
            logger.exception("ani-resolver AstrBot tool failed")
            return f'{{"schemaVersion":"ani-resolver.astrbot-error.v1","error":{{"code":"plugin_error","message":{_json_string(str(error))}}}}}'

    async def _build_and_invoke(self, builder: Callable[..., list[str]], *args, **kwargs) -> str:
        try:
            command = builder(*args, **kwargs)
        except ValueError as error:
            return f'{{"schemaVersion":"ani-resolver.astrbot-error.v1","error":{{"code":"invalid_input","message":{_json_string(str(error))}}}}}'
        return await self._invoke(command)

    @filter.llm_tool(name="ani_resolver_provider_list")
    async def provider_list(self, event: AstrMessageEvent) -> str:
        """列出动画识别数据源、能力、认证要求和初始化状态。"""
        return await self._build_and_invoke(build_provider_list_args)

    @filter.llm_tool(name="ani_resolver_parse")
    async def parse_content(self, event: AstrMessageEvent, input: str) -> str:
        """解析标题、发布名、路径、种子或磁力链接中的作品、季度、集数和外部 ID 证据。

        Args:
            input(string): 用户提供的标题、发布名、路径、种子路径或磁力链接
        """
        return await self._build_and_invoke(build_parse_args, input)

    @filter.llm_tool(name="ani_resolver_resolve_work")
    async def resolve_work(
        self,
        event: AstrMessageEvent,
        input: str,
        top: int = 5,
        providers: str = "",
    ) -> str:
        """将动画标题、发布名、路径、种子或磁力链接解析为多个作品候选及跨源 ID。

        Args:
            input(string): 要识别的内容
            top(number): 返回候选数量，1 到 20，默认 5
            providers(string): 逗号分隔的数据源 ID；留空使用全部已就绪数据源
        """
        return await self._build_and_invoke(
            build_resolve_args,
            "work",
            input,
            top=top,
            providers=providers,
        )

    @filter.llm_tool(name="ani_resolver_resolve_character")
    async def resolve_character(
        self,
        event: AstrMessageEvent,
        input: str,
        work: str = "",
        top: int = 5,
        providers: str = "",
    ) -> str:
        """根据角色名或外形特征返回多个角色候选；已知作品时应传入作品 ID 缩小范围。

        Args:
            input(string): 角色名或角色文字特征
            work(string): 可选作品 ID，例如 bangumi:400602、anilist:154587
            top(number): 返回候选数量，1 到 20，默认 5
            providers(string): 逗号分隔的数据源 ID；留空使用全部已就绪数据源
        """
        return await self._build_and_invoke(
            build_resolve_args,
            "character",
            input,
            top=top,
            providers=providers,
            work=work,
        )

    @filter.llm_tool(name="ani_resolver_entity_get")
    async def entity_get(
        self,
        event: AstrMessageEvent,
        entity_type: str,
        external_id: str,
        provider: str = "",
    ) -> str:
        """按外部 ID 获取并核验一个动画作品或角色实体。

        Args:
            entity_type(string): 实体类型，只能是 work 或 character
            external_id(string): 外部 ID，例如 bangumi:400602、anilist:176754、wikidata:Q104144455
            provider(string): 可选指定数据源，例如 bangumi-archive、anilist、wikidata
        """
        return await self._build_and_invoke(
            build_entity_get_args,
            entity_type,
            external_id,
            provider,
        )

    @filter.llm_tool(name="ani_resolver_work_characters")
    async def work_characters(
        self,
        event: AstrMessageEvent,
        external_id: str,
        provider: str = "",
    ) -> str:
        """列出已知动画作品中的角色，适合在角色描述含糊时缩小候选范围。

        Args:
            external_id(string): 作品 ID，例如 bangumi:400602、anilist:154587、wikidata:Q12345
            provider(string): 可选指定数据源，例如 bangumi、bangumi-archive、anilist、wikidata
        """
        return await self._build_and_invoke(
            build_work_characters_args,
            external_id,
            provider,
        )


def _json_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)
