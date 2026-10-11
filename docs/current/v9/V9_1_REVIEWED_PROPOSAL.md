# VOCT V9.1 详细施工方案（重新审查版）

> 项目：VOCTNOW / Voices of the Court\
> 阶段：V9.1 Architecture Stabilization & Context Core Refactoring\
> 前置版本：V9.0\
> V9.0状态： - VOCT-NEW 已推送 V9.0 - Three-Mod 已迁移至
> CK3-Three-Mod-Compatibility 独立仓库 - GitHub Actions 已恢复 -
> 启动性能诊断框架已加入
>
> V9.1目标：
>
> **不是新增玩法，而是完成 VOCT 从 V8
> 后期堆叠式工程向长期维护架构的转换。**

------------------------------------------------------------------------

# 1. V9.1阶段定位

## 1.1 V8 → V9阶段演进

### V8阶段

核心目标：

> 建立可信的历史世界模拟系统。

完成：

-   Campaign Namespace
-   Actual State
-   Worldline
-   Memory4
-   Knowledge Boundary
-   Relationship
-   Action System
-   CK3 Bridge

V8解决的是：

"NPC知道什么、世界发生什么"。

------------------------------------------------------------------------

### V9阶段

核心目标：

> 将已有系统工程化。

V9不追求增加更多系统，而解决：

-   模块边界
-   性能
-   Token成本
-   数据一致性
-   UI体验
-   备份恢复
-   测试体系

------------------------------------------------------------------------

# 2. V9.1核心目标

V9.1负责：

## Context Core 与 Runtime Contract 稳定化

包括：

1.  Conversation生命周期整理
2.  Memory4接口规范化
3.  Worldline调用边界明确
4.  CK3 Bridge协议统一
5.  Prompt上下文构建优化
6.  数据所有权明确

------------------------------------------------------------------------

# 3. 当前项目审查结论

## 3.1 已完成

### V9.0完成：

  项目            状态
  --------------- ------
  V8冻结          完成
  Three-Mod分离   完成
  CI修复          完成
  性能诊断入口    完成
  行为合同文档    完成

------------------------------------------------------------------------

# 4. 当前主要架构问题

## 4.1 Conversation职责过重

当前Conversation承担：

-   对话生命周期
-   CK3状态读取
-   Memory召回
-   Worldline查询
-   Prompt生成
-   Provider调用
-   Action处理

长期风险：

    Conversation
     ├── Memory
     ├── Worldline
     ├── CK3
     ├── Prompt
     └── Provider

任何模块变化都会影响核心流程。

------------------------------------------------------------------------

## 4.2 Memory4调用边界不足

当前：

Memory不仅负责存储，还参与：

-   召回判断
-   Context组合
-   历史摘要
-   权限过滤

V9.1目标：

Memory只负责：

    Query
     ↓
    Recall
     ↓
    Validate
     ↓
    Return Context

不负责：

-   Prompt拼接
-   NPC回复生成
-   Provider调用

------------------------------------------------------------------------

## 4.3 CK3 Bridge需要协议化

目前已有：

-   VOTC:IN
-   VOTC:DATE
-   RunFile
-   Action ACK
-   Letter

但缺少统一协议层。

目标：

    VOCT Runtime

          |
          |
    Bridge Protocol

          |

    CK3 Mod

------------------------------------------------------------------------

# 5. V9.1施工范围

------------------------------------------------------------------------

# WP-01 Context Core重构

## 目标

建立统一Context Pipeline。

当前：

    Conversation
     ↓
    Memory
     ↓
    Prompt
     ↓
    LLM

目标：

    Conversation Manager

    ↓

    Context Builder

    ↓

    {
     world_context,
     memory_context,
     relationship_context,
     ck3_context,
     instruction_context
    }

    ↓

    Prompt Builder

    ↓

    Provider

------------------------------------------------------------------------

## 工作内容

### 1. Context对象统一

新增：

``` javascript
ContextPackage
{
 campaign,
 owner,
 character,
 worldline,
 memory,
 relationship,
 permissions,
 timestamp
}
```

------------------------------------------------------------------------

### 2. 禁止模块越权

禁止：

Conversation直接读取JSON。

必须：

    Conversation
     ↓
    Service
     ↓
    Storage

------------------------------------------------------------------------

# WP-02 Memory4稳定化

## 保留

必须保持：

-   Owner Scope
-   Campaign Scope
-   Disclosure
-   KnownBy
-   Forget
-   Tombstone
-   Recovery

------------------------------------------------------------------------

## 新增

## Memory Integrity Check

检查：

-   JSON损坏
-   Scope错误
-   Index失效
-   Tombstone复活

------------------------------------------------------------------------

## Memory Lifecycle

统一：

    Create

    ↓

    Store

    ↓

    Index

    ↓

    Recall

    ↓

    Forget

    ↓

    Archive

------------------------------------------------------------------------

# WP-03 Worldline边界整理

## 当前职责

Worldline负责：

-   历史事实
-   当前世界状态
-   时间线查询

------------------------------------------------------------------------

## V9.1目标

拆分：

    Worldline

    ├── Canon Layer
    │
    ├── Current State
    │
    ├── Timeline Query
    │
    └── Projection

禁止：

Memory写入Worldline。

Conversation修改Canon。

------------------------------------------------------------------------

# WP-04 CK3 Bridge Protocol

## 协议定义

## Request

``` json
{
"id":"",
"type":"",
"payload":{}
}
```

## ACK

``` json
{
"id":"",
"status":
"pending|success|failed"
}
```

------------------------------------------------------------------------

## 状态机

    REQUEST

    ↓

    SENT

    ↓

    EXECUTED

    ↓

    ACK_RECEIVED

    ↓

    CONFIRMED

禁止：

UNKNOWN = SUCCESS

------------------------------------------------------------------------

# WP-05 Prompt与Token优化

## 目标

降低：

-   重复Context
-   无效历史
-   Token浪费

------------------------------------------------------------------------

## 方法

建立：

    Prompt Layer

    ├── System
    ├── Role
    ├── Memory
    ├── World
    ├── Relationship
    └── Recent

每层独立统计：

-   token数量
-   来源
-   命中率

------------------------------------------------------------------------

# WP-06 性能专项

继续V9.0性能调查。

重点：

## 冷启动

测量：

-   Application startup
-   Memory loading
-   CK3读取
-   Worldline初始化

## 单轮

测量：

-   Context Build
-   Prompt Build
-   Provider TTFT
-   Action latency

------------------------------------------------------------------------

# 6. 测试方案

## 单元测试

覆盖：

-   Memory
-   Context
-   Bridge

------------------------------------------------------------------------

## 行为合同测试

必须验证：

### Memory

-   Forget后不可召回
-   非授权信息不可出现

### Bridge

-   ACK必须真实
-   Failed不可确认

### Worldline

-   时间线不可污染

------------------------------------------------------------------------

# 7. 开发顺序

## Phase 1

架构分析

输出：

-   Runtime Dependency Map
-   Data Ownership Ledger

------------------------------------------------------------------------

## Phase 2

Context Core迁移

优先：

-   Context对象
-   Prompt接口

------------------------------------------------------------------------

## Phase 3

Memory4接口整理

------------------------------------------------------------------------

## Phase 4

Bridge协议化

------------------------------------------------------------------------

## Phase 5

性能优化

------------------------------------------------------------------------

# 8. V9.1禁止修改

禁止：

-   Memory5
-   SQLite
-   新Action系统
-   NPC自主行为
-   大规模Prompt改写
-   CK3玩法扩展

原因：

这些属于V10或VOCT 2.0范围。

------------------------------------------------------------------------

# 9. V9.1完成标准

## 架构

-   Conversation不直接管理所有模块
-   Context统一

## 数据

-   Memory责任明确
-   Worldline责任明确

## Bridge

-   协议完整
-   ACK可靠

## 性能

-   卡顿数据可定位

## 工程

-   CI通过
-   文档同步
-   可进入V9.2

------------------------------------------------------------------------

# 总结

V9.1不是功能版本。

它是VOCT从：

"能运行的大型Mod工具"

向：

"长期维护的AI角色世界模拟平台"

转换的架构版本。

V9.0解决边界。

V9.1解决内部秩序。

V9.2以后才继续扩展关系系统、Action增强和高级世界模拟。
