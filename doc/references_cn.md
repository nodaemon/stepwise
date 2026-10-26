# 参考资料

本文档汇总 AI 工作流可靠性相关的 48 条参考资料，覆盖官方工程指南、受控实验与实证论文、综述、书籍以及评测工具链。

编号【1】至【48】与配套报告《AI 工作流可靠性：业界知识地图、设计准则与落地路径》正文中的引用标记一一对应，可按编号直接回溯原文。

这些材料并非同一可信度。厂商的一手工程实践与带对照组、消融实验的受控实验可直接作为工程决策依据；单场景实证论文适合作为设计倾向，迁移前需在自己场景复现；厂商经验法则与社区经验只能作为假设，不值得投入验证成本。阅读时建议先看「官方工程指南」与「校验与自纠错」两组，它们覆盖了绝大多数设计决策。

---

## 目录

- [官方工程指南](#官方工程指南)
- [校验与自纠错](#校验与自纠错)
- [评测与裁判](#评测与裁判)
- [目标与指令表述](#目标与指令表述)
- [上下文与长任务](#上下文与长任务)
- [任务分解与规划](#任务分解与规划)
- [提示词方法全景](#提示词方法全景)
- [已被证伪或需限定的说法](#已被证伪或需限定的说法)
- [书籍与中文资源](#书籍与中文资源)
- [工具与框架](#工具与框架)

---

## 官方工程指南

厂商自己写出来的工程实践，含量最高，也最容易被误读成"官方定律"。注意区分其中的量化结论与经验法则。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【1】 | [Anthropic. Building effective agents](https://www.anthropic.com/research/building-effective-agents) | 五种工作流模式（提示链、路由、并行化、编排-工人、评估-优化）、三条设计原则、工具设计附录；解释编码 agent 为何有效——代码可被自动化测试验证。 |
| 【2】 | [Anthropic. Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | context rot、注意力预算、"合适的抽象层级"，并点名"错误地假设了共享上下文"这一失效模式。 |
| 【3】 | [Anthropic. Harness design for long-running apps](https://www.anthropic.com/research/harness-design-long-running-apps) | 生成者与评测者分离、动手前先约定 sprint 合约、校验与构建的成本量级、把复杂度当作可回收的假设。 |
| 【4】 | [Anthropic. Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) | 任务/试验/评分器/轨迹/结果等评测构件的定义，三类评分器的能力与代价，能力评测与回归评测分层，pass@k 与 pass^k 的区别。 |
| 【5】 | [Anthropic. Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents) | 初始化 agent、功能清单用 JSON 存储、禁止修改测试，以及"提前宣布完成但未做恰当测试"这一失败模式的对策。 |
| 【6】 | [Anthropic. Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | 工具描述本身当作提示词来写：命名空间化、token 效率、响应结构、错误响应要含修复方法；并建议避免过严的验证器。 |
| 【7】 | [Anthropic. Claude Code: Best practices for agentic coding](https://www.anthropic.com/research/claude-code-best-practices) | 会话启动协议（读 git 日志与进度文件、选优先级最高的未完成项）、探索到计划到编码到提交流程、测试驱动与子代理复核。 |
| 【8】 | [Anthropic. How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | token 成本结构（agent 约为对话的 4 倍，多智能体约 15 倍）、并行化的收益、以及面向结果的评测方式。 |
| 【9】 | [OpenAI. A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) | 指令写法四条、编排与多智能体选择、工具数量与重叠度的经验、护栏分层（相关性/安全分类器、PII 过滤、工具风险分级）、人工介入的触发条件。PDF，34 页。 |

## 校验与自纠错

这一组回答"校验该挂在哪里"。结论高度一致：决定校验有效性的变量是校验读取的信号是否来自系统外部，而不是校验写在提示词里还是流程末尾。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【10】 | [When Do Agent Loops Mistake Stagnation for Progress? arXiv:2607.25152](https://arxiv.org/abs/2607.25152) | 固定 agent 与工具面、只改变评测者的信息通道类型的受控实验。自述信号信息量为零，评测者仍会接受大量真实回归、拒绝大量真实改进；详细反馈与 sign-only 反馈效果相当。 |
| 【11】 | [Can LLMs Really Improve by Self-critiquing Their Own Plans? arXiv:2310.08118](https://arxiv.org/abs/2310.08118) | 计划自评反而降低生成质量，尤其在配备会产生大量假阳性的 LLM 评测者时；反馈是二值还是详细，影响很小。 |
| 【12】 | [Large Language Models Cannot Self-Correct Reasoning Yet. arXiv:2310.01798](https://arxiv.org/abs/2310.01798) | 无外部反馈时 LLM 难以自我纠正，有时自我纠正后性能反而下降。ICLR 2024。 |
| 【13】 | [CRITIC: LLMs Can Self-Correct by Tool-Interactive Critiquing. arXiv:2305.11738](https://arxiv.org/abs/2305.11738) | 由工具提供事实依据后，自纠错才带来提升；作者据此指出外部反馈在自我改进中至关重要。 |
| 【14】 | [Let's Verify Step by Step. arXiv:2305.20050](https://arxiv.org/abs/2305.20050) | MATH 数据集上，过程监督（逐步打分）训出的过程奖励模型显著优于只对最终答案打分的 outcome 监督。ICLR 2024。 |
| 【15】 | [Self-Refine: Iterative Refinement with Self-Feedback. arXiv:2303.17651](https://arxiv.org/abs/2303.17651) | 同一个模型同时充当生成者、精修者与反馈提供方，在 7 类生成质量任务上报告约 20% 的平均绝对提升。 |
| 【16】 | [Chain-of-Verification Reduces Hallucination in LLMs. arXiv:2309.11495](https://arxiv.org/abs/2309.11495) | 先规划验证问题、再用证据逐条独立作答，可降低幻觉。ACL 2024。 |
| 【17】 | [Reflexion: Language Agents with Verbal Reinforcement Learning. arXiv:2303.11366](https://arxiv.org/abs/2303.11366) | 把反馈写进记忆供后续尝试使用，HumanEval 上 pass@1 达 91%，高于当时 GPT-4 的 80%。 |
| 【18】 | [Self-Consistency Improves Chain of Thought Reasoning. arXiv:2203.11171](https://arxiv.org/abs/2203.11171) | 采样多条推理路径并多数投票，在 GSM8K、SVAMP、AQuA、StrategyQA、ARC-Challenge 上分别带来 17.9%、11.0%、12.2%、6.4%、3.9% 的提升。 |
| 【19】 | [On the Limits of Metacognitive Monitoring in LLMs. arXiv:2609.34864](https://arxiv.org/abs/2609.34864) | 高任务准确率可以与弱的错误判别能力共存；模型对自己答案对错的排序仅略好于随机，两个模型共有的错误通常保持高置信度。 |
| 【20】 | [Can LLMs Judge Better Than They Generate? arXiv:2606.28050](https://arxiv.org/abs/2606.28050) | 四个基准中三个上生成准确率高于自评准确率；注意力分析显示评判对上下文的关注比生成少 3 到 5 倍，且几乎不读候选答案本身。 |
| 【24】 | [When Should a Language Model Trust Itself? arXiv:2605.02915](https://arxiv.org/abs/2605.02915) | 同模型自检只能作为条件性的置信信号，强烈依赖任务与模型，不能当作通用不确定性估计器。 |

## 评测与裁判

裁判模型不是中性测量仪器，它的偏差会直接变成你的评测指标偏差。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【21】 | [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. arXiv:2306.05685](https://arxiv.org/abs/2306.05685) | 识别出位置偏置、冗长偏置与自我增强偏置并验证其可复现；与人类偏好的对齐率虽超过 80%，偏差本身是系统性的。 |
| 【22】 | [G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment. arXiv:2303.16634](https://arxiv.org/abs/2303.16634) | 用链式思维加概率加权打分，改善 GPT-4 评估与人类判断的对齐。EMNLP 2023。 |
| 【23】 | [Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters. arXiv:2408.03314](https://arxiv.org/abs/2408.03314) | 推理期扩展中，依赖密集过程验证器的搜索收益显著，而不少扩展策略得到的是负面结果。 |

## 目标与指令表述

对应"提示词里的任务目标不能出现约定内容"这一要求。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【25】 | [Coding Agents Are Guessing: Underspecification and Action-Boundary Violations. arXiv:2607.02294](https://arxiv.org/abs/2607.02294) | 69 个任务族、2208 个提示词变体、5 组 agent 与模型配置。55.8% 到 67.8% 的运行至少违反一条边界；关键结论是欠规范不会让 agent 明确失败，而是让它去猜。 |
| 【30】 | [The Instruction Hierarchy: Training LLMs to Prioritize Privileged Instructions. arXiv:2404.13208](https://arxiv.org/abs/2404.13208) | 系统指令、用户指令与工具输出之间的优先级；与目标表述相关的约束关系，护栏设计也依赖它。 |

## 上下文与长任务

长任务的失败很少出在提示词上，主要出在这一层。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【26】 | [Diagnosing and Mitigating Context Rot in Long-horizon Search. arXiv:2606.29718](https://arxiv.org/abs/2606.29718) | 上下文高度耗用时模型会在远未耗尽窗口前提前终止，提前终止率与上下文长度正相关；测试了七种分属三类的上下文管理方法。 |
| 【27】 | [Classifier Context Rot. arXiv:2605.12366](https://arxiv.org/abs/2605.12366) | 在 800K token 的良性活动之后，Opus 4.6、GPT-5.4、Gemini 3.1 漏掉危险动作的频率上升 2 到 30 倍，定期提醒可以缓解。 |
| 【28】 | [Lost in the Middle: How Language Models Use Long Contexts. arXiv:2307.03172](https://arxiv.org/abs/2307.03172) | 长上下文中间位置的信息召回最差，是注意力预算呈凸性的经典证据。TACL 2024。 |

## 任务分解与规划

这一组解决"步骤怎么切"，不解决"切完之后怎么验"。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【34】 | [Decomposed Prompting: A Modular Approach for Solving Complex Tasks. arXiv:2210.02406](https://arxiv.org/abs/2210.02406) | 把复杂任务拆成模块化子任务逐个解决的通用框架。ICLR 2023。 |
| 【35】 | [Least-to-Most Prompting Enables Complex Reasoning in LLMs. arXiv:2205.10625](https://arxiv.org/abs/2205.10625) | 先分解为子问题，再按依赖顺序求解。ICLR 2023。 |
| 【36】 | [Tree of Thoughts: Deliberate Problem Solving with LLMs. arXiv:2305.10601](https://arxiv.org/abs/2305.10601) | 引入自评与前瞻做显式搜索，把"想哪几条路"显式化。 |
| 【37】 | [ReAct: Synergizing Reasoning and Acting in Language Models. arXiv:2210.03629](https://arxiv.org/abs/2210.03629) | 推理与行动交替进行，agent 形态的基础范式。 |
| 【38】 | [Chain-of-Thought Prompting Elicits Reasoning in LLMs. arXiv:2201.11903](https://arxiv.org/abs/2201.11903) | 上述方法的共同基础。 |

## 提示词方法全景

覆盖全面但以分类罗列为主，适合用来建立坐标系，不适合直接照搬结论。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【31】 | [A Systematic Survey of Prompt Engineering in Large Language Models: Techniques and Applications. arXiv:2402.07927](https://arxiv.org/abs/2402.07927) | 提示词工程技术的分类体系与应用面梳理。 |
| 【32】 | [The Prompt Report: A Systematic Survey of Prompt Engineering Techniques. arXiv:2406.06608](https://arxiv.org/abs/2406.06608) | 覆盖面更广的一份综述，含大量可对照的实验设置说明。 |
| 【33】 | [Unleashing the Potential of Prompt Engineering in LLMs: A Comprehensive Review. arXiv:2310.14735](https://arxiv.org/abs/2310.14735) | 提示词潜力的全面评述，梳理设计原则与常见模式。 |

## 已被证伪或需限定的说法

遇到这几类说法时应回到对应文献，而不是凭直觉采信。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【29】 | [When "A Helpful Assistant" Is Not Really Helpful: Personas in System Prompts Do Not Improve Performances of LLMs. arXiv:2311.10054](https://arxiv.org/abs/2311.10054) | 覆盖 162 种角色、6 种关系类型、8 个专业领域、4 个模型家族、2410 道事实题，发现系统提示中加入人格设定相对无人格设定没有带来性能提升。角色设定仍可用于固定输出风格或流程行为，但不能当作准确性杠杆。 |

另有两类说法可对照【4】【6】判断：温度设为 0 并不能保证同一模型在同一提示下行为完全一致（评测需多次试验并报告通过率分布）；分解类方法有正面证据【34】【35】【36】，但它们大多依赖外部结构或外部验证器，与"让模型自己把思考写得更细"不是一回事。

## 书籍与中文资源

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【41】 | Huyen, C. AI Engineering: Building Applications with Foundation Models. O'Reilly, 2025. 中文版《AI 工程：大模型应用开发实战》，人民邮电出版社 2026，ISBN 9787115686398，宝玉译。[书目记录](https://opac.ouc.edu.cn/mspace/searchDetailLocal/md2b5c574ce3e6440213739b43a846a8a) | 体系较完整的一本，覆盖模型选型、提示工程、检索、评测与上线。 |
| 【42】 | Gullí, A.《Agentic 智能体设计模式》，清华大学出版社 2026，ISBN 9787302712435。[书目信息](https://book.cppinfo.cn/Encyclopedias/home/index?id=5065380) | 21 种智能体设计模式，代码基于 LangChain 与 LangGraph、CrewAI、Google ADK，与【1】的五种工作流模式可对照阅读。 |
| 【43】 | 陆徐洲著。《Harness Engineering 实战：构建可靠的生产级 AI Agent》，电子工业出版社 2026，ISBN 9787121532245。[书目信息](https://item.kongfz.com/item/book/23656167) | 中文世界贴近本主题的一本：约束、工具、上下文、记忆、验证、反馈六层，含自评偏差与假阳性量化、Sprint Contract、上下文分级压缩与成本治理。 |
| 【44】 | 张建飞著。《Harness 工程实战：从零开始驾驭 AI 软件工程》，人民邮电出版社 2026，ISBN 9787115701800。[书目信息](https://book.cppinfo.cn/Encyclopedias/home/index?id=5110916) | 驾驭工程体系与 Prompt、Context Engineering 方法论，含测试、环境管理与持续交付。 |
| 【45】 | 樊中恺著。《大模型应用开发：评估、优化与工程实践》，人民邮电出版社 2026，ISBN 9787115705747。[书目信息](https://book.cppinfo.cn/Encyclopedias/home/index?id=5131418) | 以"评估—优化—验证"循环为核心的可量化质量保障体系。 |
| 【39】 | [DAIR.AI. 提示工程指南，中文版](https://www.promptingguide.ai/zh) | 免费的中文材料，适合用来建立坐标系，具体技巧需对照论文判断证据强度。 |
| 【40】 | [DAIR.AI. Prompt Engineering Guide（GitHub 仓库）](https://github.com/dair-ai/Prompt-Engineering-Guide) | 覆盖提示词工程、上下文工程、RAG 与 AI Agents 四个方向，含论文、课程与 notebook。 |

## 工具与框架

把评测当作代码资产来管理的三个工具，判据设计仍需自己定义。

| 编号 | 文献 | 内容要点 |
|---|---|---|
| 【46】 | [Stanford NLP. DSPy: The framework for programming, not prompting, language models](https://github.com/stanfordnlp/dspy) | 把提示词工程改成程序化优化，与评测驱动的主张一致。 |
| 【47】 | [promptfoo. The evaluation framework for LLMs and AI agents](https://www.promptfoo.dev) | 提示词与 agent 的回归测试、对比评测。 |
| 【48】 | [Confident AI. DeepEval](https://github.com/confident-ai/deepeval) | pytest 风格的 agent 与 LLM 输出评测。 |

---

## 维护说明

新增条目时请沿用【N】编号，不要重排既有编号，否则会破坏与配套报告正文的对应关系。分组按"能回答什么问题"划分，而非按发布时间或来源机构划分。收录标准有两条：一是原始链接可直接访问，二是能说清它具体提供了什么证据或方法，而不只是一个宽泛的方向。
