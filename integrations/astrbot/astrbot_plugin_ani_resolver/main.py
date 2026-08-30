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
    build_resolve_character_args,
    build_resolve_args,
    build_resolve_image_args,
    build_work_characters_args,
    resolve_event_image_input,
)


@register(
    "astrbot_plugin_ani_resolver",
    "scieszk",
    "为 AstrBot 提供动画作品、角色和外部 ID 的多源识别工具",
    "0.4.0",
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
        providers: str,
        top: int = 5,
    ) -> str:
        """将动画标题、发布名、路径、种子或磁力链接解析为多个作品候选及跨源 ID。

        Args:
            input(string): 要识别的内容
            top(number): 返回候选数量，1 到 20，默认 5
            providers(string): 必选的逗号分隔数据源 ID，或显式传入 all；应先调用数据源列表选择
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
    ) -> str:
        """根据结构化角色名、作品和外形标签返回多个角色候选。

        Args:
            providers(string): 必选的逗号分隔数据源 ID，或显式传入 all；应先调用数据源列表选择
            name(string): 可选的字面角色名，不要放入描述句
            work(string): 可选作品 ID，例如 bangumi:400602、anilist:154587
            top(number): 返回候选数量，1 到 20，默认 5
            hair_colors(string): 可选英文发色标签，多个值用逗号分隔，例如 white,silver
            eye_colors(string): 可选英文瞳色标签，多个值用逗号分隔
            hair_styles(string): 可选英文发型标签，例如 twintails,long_hair
            genders(string): 可选英文性别标签，例如 female
            apparent_ages(string): 可选英文外观年龄标签，例如 child,teen,adult
            clothing(string): 可选英文服装标签，例如 school_uniform,armor,glasses
            traits(string): 可选英文特征标签，例如 expressionless
        """
        return await self._build_and_invoke(
            build_resolve_character_args,
            name=name,
            top=top,
            providers=providers,
            work=work,
            hair_colors=hair_colors,
            eye_colors=eye_colors,
            hair_styles=hair_styles,
            genders=genders,
            apparent_ages=apparent_ages,
            clothing=clothing,
            traits=traits,
        )

    @filter.llm_tool(name="ani_resolver_resolve_image")
    async def resolve_image(
        self,
        event: AstrMessageEvent,
        providers: str,
        input: str = "",
        top: int = 5,
    ) -> str:
        """从图片识别动画场景、原图出处或动漫角色，并保留各数据源自己的排名信号。

        Args:
            providers(string): 必选的逗号分隔数据源 ID，例如 trace-moe、saucenao、animetrace
            input(string): 可选 HTTP(S) 图片 URL；留空读取当前或被回复消息中的图片
            top(number): 每个数据源返回的候选数量，1 到 20，默认 5
        """
        explicit_input = input.strip()
        resolved_input = explicit_input or await resolve_event_image_input(event)
        if not resolved_input:
            return '{"schemaVersion":"ani-resolver.astrbot-error.v1","error":{"code":"image_unavailable","message":"No image was found in the tool input, current message, or replied message"}}'
        return await self._build_and_invoke(
            build_resolve_image_args,
            resolved_input,
            top=top,
            providers=providers,
            allow_local=not explicit_input,
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
