"use strict";

const { MONEY_TRANSFER_PATTERN, MONEY_TRANSFER_FAILURE_PATTERN } = require("./money-lexicon");

function detect(text, { candidateOnly = false } = {}, { registry } = {}) {
    if (!text || typeof text !== "string") return [];
    // Judge future tense only inside the clause that contains the candidate
    // action. This prevents a later plan ("明日再谈") from cancelling an
    // already-completed action in an earlier clause ("我给了他100金币").
    const futureMarker = /(?:\u5c06(?:\u8981|\u4f1a)|(?:我|你|他|她|它|我们|你们|他们|她们)会|\u51c6\u5907|\u6253\u7b97|\u8ba1\u5212|\u60f3\u8981|\u6b32\u8981|愿意|\u7ea6\u597d|\u660e\u65e5|\u660e\u5929|\u5f85\u4f1a|\u5f85\u4f1a\u513f|\u7a0d\u540e|\u8fc7\u4f1a\u513f|\u7b49\u4e0b|\u8fdf\u4e9b\u65f6\u5019|\u6539\u65e5|\u4e4b\u540e\u518d|\u4e4b\u5f8c\u518d|\b(?:will|going to|plan to|wants? to|tomorrow|later)\b)/i;
    const completionMarker = /(?:\u5df2\u7ecf|\u5df2\u7136|\u521a\u521a|\u65b9\u624d|\u4e8b\u6bd5|\u5b8c\u4e8b|\b(?:already|just|completed?|finished)\b)/i;
    const failedAttemptMarker = /(?:试图|尝试|企图|没能|未能|没有(?:成功|得逞|做到|碰到|伤到|亲到|打中)|躲开|避开|闪开|挣脱|拒绝|推开|落空|被.{0,8}挡|挡下|missed|failed to|did not|didn't|dodged|avoided|refused)/i;
    const hypotheticalMarker = /(?:如果|假如|倘若|若是|要是|也许|或许|可能会|不妨考虑|\b(?:if|maybe|perhaps|might|could)\b)/i;
    const futureLeadIn = /(?:\u51c6\u5907|\u6253\u7b97|\u8ba1\u5212|\u60f3\u8981|\u6b32\u8981|愿意|\u5c06\u8981|\u5c06\u4f1a|(?:我|你|他|她|它|我们|你们|他们|她们)会|\u660e\u65e5|\u660e\u5929|\u5f85\u4f1a|\u5f85\u4f1a\u513f|\u7a0d\u540e|\u8fc7\u4f1a\u513f|\u7b49\u4e0b|\u8fdf\u4e9b\u65f6\u5019|\u6539\u65e5|\b(?:will|going to|plan to|tomorrow|later)\b)\s*$/i;
    // 保留每个分句末尾的问号；否则 split 会让“你拔剑？”变成“你拔剑”，
    // 导致下方的疑问句门控无法识别。
    const clauses = (text.match(/[^。！？；，.!?;,\n]+[？?]?/g) || []).map((clause) => clause.trim()).filter(Boolean);
    if (clauses.length === 0) clauses.push(text);
    // Requests and questions often contain the same verb as an action report
    // ("拿起剑吧", "你会拔剑吗？") but have not changed CK3 state.
    const isNonExecutedActionClause = (clause, actionMatch) => {
      const prefix = clause.slice(Math.max(0, actionMatch.index - 20), actionMatch.index);
      if (/[？?]/.test(clause) || /(?:吧|吗|么|呢|如何|可否|能否|好吗)[！!。]?$/.test(clause)) return true;
      // Mentioning an action is not performing it. This keeps lore, rumours,
      // recollections and dialogue about an event from changing game state.
      if (/(?:谈论|讨论|提及|讲述|回忆|描述|声称|听说|传闻|假装).{0,12}$/i.test(prefix)) return true;
      return /(?:请|命令|要求|让|叫|希望|想|要|欲|准备|打算|计划|将(?:要|会)|会|能否|可否|是否|别|不要|莫|不许|不准)\s*(?:我|你|他|她|它|我们|你们|他们|她们|众人|侍从|护卫)?\s*$/i.test(prefix);
    };
    const describesCompletedOrCurrentAction = (pattern, rejectFailedAttempt = false, failurePattern = null) => clauses.some((clause, clauseIndex) => {
      const actionMatch = pattern.exec(clause);
      if (!actionMatch) return false;
      if (isNonExecutedActionClause(clause, actionMatch)) return false;
      const actionPrefix = clause.slice(Math.max(0, actionMatch.index - 8), actionMatch.index);
      const adjacentFailure = /(?:没有|并未|不曾|未曾|尚未)/.test(actionPrefix) || failedAttemptMarker.test(clause) || clauseIndex + 1 < clauses.length && failedAttemptMarker.test(clauses[clauseIndex + 1]) || failurePattern && (failurePattern.test(clause) || clauseIndex + 1 < clauses.length && failurePattern.test(clauses[clauseIndex + 1]));
      if (rejectFailedAttempt && adjacentFailure) return false;
      const futureMatch = futureMarker.exec(clause);
      const inheritsFuture = clauseIndex > 0 && futureLeadIn.test(clauses[clauseIndex - 1]);
      if ((!futureMatch && !inheritsFuture) || completionMarker.test(clause)) return true;
      if (inheritsFuture && !futureMatch) return false;
      // A future marker appearing after the matched action normally modifies a
      // later thought, even if the writer omitted punctuation.
      return futureMatch.index > actionMatch.index + actionMatch[0].length;
    });
    const completedSexualAction = /(?:(?:已经|已)(?:同房|圆房|行房|完成房事)|完成(?:了)?(?:交合|行房|房事|同房|圆房|性事)|发生(?:了)?(?:性关系|肉体关系)|(?:行|享|同享)(?:了|过)?(?:一场|一番)?鱼水之欢|(?:鱼水之欢|云雨)(?:已)?(?:毕|罢)|(?:一番云雨|云雨一番)(?:之后|过后)|云雨(?:了|过)?一番|行过房事|共度(?:了|过)?春宵(?:之后|过后)?|春宵一度|(?:已有|有了)夫妻之实|had (?:sexual )?intercourse|had sex|made love|consummated)/i;
    const rules = [
      { reason: "gold", pattern: MONEY_TRANSFER_PATTERN, failurePattern: MONEY_TRANSFER_FAILURE_PATTERN },
      { reason: "imprisonment", pattern: /(?:囚禁|关进|关押|投入(?:大牢|地牢)|收监|逮捕|拘押|软禁|拿下|押下|押入|押进|押往|押送(?:入|至).{0,8}(?:牢|狱)|下狱|入狱|捆(?:起|住)来?|绑(?:起|住)来?|上(?:了)?枷锁|戴上(?:镣铐|枷锁)|锁进(?:牢房|地牢)?|铁链(?:锁住|缚住)|imprison(?:ed)?|arrest(?:ed)?|jailed?|locked up|put in chains)/i },
      { reason: "death_or_injury", pattern: /(?:杀死|杀了|砍死|刺死|毒死|勒死|掐死|打死|烧死|淹死|处死|斩首|枭首|人头落地|身首异处|毙命|殒命|气绝|断气|倒地(?:身亡|死去)|(?:割|砍|斩|削)(?:了)?(?:下|断|落).{0,4}(?:脑袋|头颅|首级|头)|(?:脑袋|头颅|首级|头).{0,6}(?:被)?(?:割|砍|斩|削)(?:了)?(?:下|断|落)|刺伤|砍伤|打伤|烧伤|冻伤|摔伤|重创|重伤|负伤|受伤|划伤|割伤|划破|割破|刺穿|贯穿|(?:刺|捅)(?:中|入|进).{0,8}(?:胸(?:口|膛)?|腹(?:部)?|肩(?:膀)?|背(?:部)?|腰(?:部)?|腿|手臂|身体|身躯|血肉)|(?:刀|剑|匕首|枪尖|刀刃|剑刃).{0,6}(?:刺入|刺进|没入|扎进)|(?:手|手臂|手指|腿|脚|耳朵|鼻子).{0,8}(?:被)?(?:割|砍|斩)(?:了)?(?:下|掉|断|落)|(?:手|手臂|肩膀|胸口|腹部|背部|腰部|腿).{0,8}(?:砍|刺|捅|划|割)(?:了)?(?:一|两|几)(?:刀|剑|下|记)|(?:砍断|斩断|砍下|斩下|割下)(?:了)?.{0,8}(?:左腿|右腿|一条腿|腿)|捅伤|扎伤|流血(?:不止)?|鲜血.{0,8}(?:流出|涌出|喷出)|伤口|骨折|断骨|昏迷|毁容|弄瞎|刺瞎|打瞎|剜.?眼|断腿|折断|打断|割下|砍下|阉割|killed?|executed|wounded|injured|maimed|disfigured|bled|bleeding|blinded|castrat|poisoned|strangled|burned|drowned)/i },
      { reason: "relationship", pattern: /(?:成为(?:了)?(?:情人|恋人|朋友|挚友|至交|死敌|宿敌|仇敌|灵魂伴侣|义兄弟)|结为(?:了)?(?:情人|恋人|朋友|挚友|至交|死敌|宿敌|义兄弟|夫妻)|(?:彼此|两人|我们).{0,8}(?:相恋|相爱|坠入爱河|成为(?:了)?恋人|成为(?:了)?挚友|成为(?:了)?至交|成为(?:了)?死敌|反目成仇|化敌为友|冰释前嫌)|(?:与|和).{0,12}(?:结为|结成|成为)(?:了)?(?:情人|恋人|朋友|挚友|至交|死敌|宿敌|仇敌|灵魂伴侣|义兄弟|盟友)|(?:你我|我们|彼此|两人|二人|你|我).{0,8}(?:便是|就是|已是|算是).{0,8}(?:我的|你的|彼此的)?(?:情人|恋人|灵魂伴侣|命定之人)|(?:认定|确认).{0,16}(?:就是|便是|是|为).{0,12}(?:情人|恋人|灵魂伴侣|命定之人)|结拜|义结金兰|义结兄弟|定情|私定终身|握手言和|和解(?:如初)?|化敌为友|正式结盟|结盟成功|结成同盟|缔结同盟|签订停战|达成停战|became? (?:lovers?|friends?|rivals?|nemeses|soulmates?)|formed? an alliance|became? blood brothers?|agreed? to (?:a )?truce)/i },
      { reason: "opinion_change", pattern: /(?:(?:对|对于).{0,16}(?:好感|好感度|评价|看法|态度|意见).{0,12}(?:增加|上升|提高|改善|下降|降低|恶化|变差|转好|转坏|大增|大减)|(?:好感|好感度|评价|看法|态度|意见).{0,12}(?:增加|上升|提高|改善|下降|降低|恶化|变差|转好|转坏|大增|大减)|(?:对).{0,12}(?:不再信任|心生好感|心怀感激|心生厌恶|怀恨在心|刮目相看|另眼相看)|(?:愈发|开始|更加|变得).{0,8}(?:敬重|钦佩|感激|信任|喜爱|厌恶|憎恨|反感|不满|敌视)|(?:戒心|态度).{0,6}(?:消散|更重|软化|缓和)|(?:失望至极|不再信任)|(?:gained?|lost|increased?|decreased?|improved?|worsened?).{0,20}(?:opinion|respect|trust|affection))/i },
      { reason: "employment_or_office", pattern: /(?:任命(?:为|了)?|册封(?:为|了)?|拜(?:为|了)?|擢升|升任|提拔(?:为|了)?|调任(?:为|至)?|委任(?:为|了)?|委派(?:为|至)?|封为|授予.{0,12}(?:官|职|爵|差事)|授官|授职|罢免|罢官|免去.{0,12}(?:官|职)|撤职|解职|革职|贬职|开除|雇佣(?:为|了)?|招募(?:为|了)?(?:骑士|侍从)?|聘为|入仕|加入.{0,12}(?:宫廷|朝廷)|效力于|逐出宫廷|appointed?|promoted?|assigned?|dismissed|fired|employed|hired|recruited)/i },
      { reason: "faith_or_vassal", pattern: /(?:改宗|皈依|改信|改奉|弃绝(?:原)?信仰|信奉.{0,12}(?:教|信仰)|奉(?:为|行).{0,12}信仰|强迫.{0,12}信仰|臣服于|归顺(?:于)?|投降(?:于)?|称臣(?:于)?|纳贡称臣|宣誓(?:效忠|臣服)|效忠于|成为.{0,12}封臣|纳为封臣|接受.{0,12}(?:宗主|主君)|converted?|vassalized|surrendered|swore fealty|pledged allegiance)/i },
      { reason: "location_or_exit", pattern: /(?:离开(?:了)?(?:这里|房间|宫廷|宴会|谈话)?|走出|退出|离席|离场|转身离去|退下|告辞|踏入|进入|来到|赶往|移步|前往(?:王座厅|花园|卧室|军营|地牢|小巷)|返回(?:了)?(?:宫廷|房间|营地|住所|花园|王座厅)|回到(?:宫廷|房间|营地|住所|花园|王座厅)|抵达(?:了)?(?:宫廷|房间|营地|花园|王座厅|军营|地牢|市场)|到达(?:了)?(?:宫廷|房间|营地|花园|王座厅|军营|地牢|市场)|搬到|移动到|left (?:the )?(?:conversation|room|court)|walked out|entered|arrived|returned to|moved? to)/i },
      { reason: "drinking_or_toast", pattern: /(?:喝(?:了|着|下)?(?:茶|酒|一口|几口|一杯)|饮(?:了|着|下)?(?:茶|酒|一口|几口|一杯)|品(?:了|着)?(?:茶|酒)|啜|呷|抿(?:了)?一口|小酌|痛饮|畅饮|满饮|饮干|酌酒|碰杯|斟满|斟(?:了)?酒|倒(?:了)?酒入杯|端起.{0,12}(?:茶盏|茶杯|酒杯|杯).{0,12}(?:喝|饮|品|啜)|举杯|举起(?:茶杯|酒杯)|向.{0,12}(?:祝酒|敬酒)|敬(?:了)?(?:茶|酒)|干(?:了)?杯|一饮而尽|饮尽|饮罢|品茗|饮茶|饮酒|drank|sipped|gulped|drained (?:the )?(?:cup|glass)|raised (?:a |the )?(?:cup|glass)|made a toast|toasted)/i },
      { reason: "daily_movement", pattern: /(?:行走|迈步|踱步|散步|快步(?:走|前行)|小跑|奔跑|奔向|冲过去|(?:^|[我你他她它])(?:走|跑)(?:了|着|向|到|近|过去|过来|一步|几步)|walked?|walking|ran|running|jogged?|strolled?|paced?)/i },
      // Low-impact prose remains available to the event parser for analytics
      // and future narrative features, but does not enter Action Runtime.
      { reason: "daily_object_interaction", pattern: /(?:拿起|拿过|拿来|拿走|取出|拾起|捡起|接过|提起|拎起|扛起|抱起|穿上|穿好|穿(?:了|着)?(?:衣|袍|裙|裤|鞋|靴|甲)|披上|戴上|套上|换上|吃了|吃下|吃掉|咬下|吞下|picked? up|took|carried|lifted|put on|wore|ate)/i },
      { reason: "combat", pattern: /(?:拔(?:出)?(?:长|短|佩|宝|铁)?(?:剑|刀|矛)|挥(?:长|短)?(?:剑|刀)|持(?:长|短)?(?:剑|刀|矛)|挥拳|出拳|打(?!算|听|探|开|扰|赌|猎|水|扫|赏|字|量|招|扮|包|造|卡|工|理|牌|针|伞|鼓)|掌掴|扇了?.{0,8}耳光|推(?:了|向|开|倒|他|她|你|我|$)|踢|踹|撞(?:了|向|上|倒|他|她|你|我|$)|扑向|摔倒|擒住|制服|缴械|刺(?:向|入|中|伤|了|他|她|你|我|$)|砍(?:向|中|下|伤|了|他|她|你|我|$)|劈(?:向|中|下|伤|了|他|她|你|我|$)|斩(?:向|中|下|伤|首|了|他|她|你|我|$)|格挡|招架|搏斗|厮打|扭打|打斗|交战|开战|冲杀|冲锋|射(?:出|中)|放箭|命中(?:了)?|击中(?:了)?|击败(?:了)?|战胜(?:了)?|duel(?:ed|ling)?|fought|attacked|punched|pushed|kicked|rammed|slammed|slapped|struck|stabbed|slashed|chopped|cleaved|parried|blocked|shot|hit|defeated|charged)/i },
      { reason: "intimacy_or_clothing", pattern: /(?:(?:脱下|脱掉|脱去|脱光|褪下|褪去|除去|扯开|撕开|解下|解衣).{0,8}(?:衣|衣裙|衣衫|外袍|亵衣|内衫|裤|腰带)|解开(?:了)?(?:衣带|腰带|衣襟)|宽衣(?:解带)?|衣衫(?:滑落|尽褪)|裸露(?:了)?|裸身|赤裸|赤身|露出.{0,8}(?:胸膛|肌肤|身体)|undressed|removed .{0,12}(?:clothes|robe|shirt|dress)|unfastened .{0,12}(?:belt|clothing))/i },
      { reason: "intimate_contact", pattern: /(?:抚摸|爱抚|舔舐|舔弄|亲吻|接吻|吻上|吻住|挑逗|撩拨|吮吸|含住|顶入|插入|进入.{0,8}(?:体内|身体)|研磨|摩擦|抽送|抽插|挺动|律动|揉捏|揉搓|caressed?|fondled?|licked?|kissed?|teased?|sucked?|penetrated?|inserted?|thrust(?:ed|ing)?|grind(?:ing)?|ground against|rubbed?)/i },
      { reason: "visible_pose", pattern: /(?:微笑|笑了|轻笑|失笑|大笑|哭泣|流泪|抽泣|哽咽|怒视|怒目而视|瞪着|跪下祈祷|祈祷|诵经|跳舞|起舞|翩翩起舞|读书|翻书|写字|执笔|伏案(?:书写|写字)|偷听|侧耳倾听|争辩|争论|讲故事|打哈欠|翻白眼|惊呆|后退|举杖|手持权杖|smiled|laughed|cried|wept|sobbed|glared|prayed|danced|read(?:ing)?|wrote|writing|eavesdropped|rolled .{0,6}eyes)/i },
      { reason: "rp_status", pattern: /(?:喝醉(?:了)?|醉了|醉醺醺|酒意上涌|烂醉如泥|酩酊大醉|勃然大怒|怒不可遏|怒火中烧|怒气冲冲|气得发抖|暴怒不已|受辱|遭到羞辱|感到羞辱|羞愧难当|羞愤不已|倍感羞辱|蒙羞|心怀感激|感激不尽|感恩戴德|惊恐万分|心生恐惧|胆战心惊|吓得发抖|疑心重重|疑虑重重|起了疑心|满怀爱意|爱意渐浓|深情款款|精疲力尽|疲惫至极|疲惫不堪|筋疲力尽|became drunk|is drunk|furious|enraged|humiliated|insulted|grateful|terrified|suspicious|affectionate|exhausted)/i },
      { reason: "faction_commitment", pattern: /(?:(?:正式|已经|当即|决定|同意)?(?:加入|退出|离开|投入|倒向).{0,18}(?:派系|阵营)|站到.{0,12}一边|(?:明确|公开|正式|决定|同意|宣布)?(?:支持|拥护|反对|抵制).{0,18}(?:宣称者|宣称派系|派系|阵营)|拥立.{0,16}(?:宣称者|为王|为君)|(?:joined|left|support(?:ed)?|opposed|backed).{0,20}(?:faction|claimant))/i },
      { reason: "prisoner_resolution", pattern: /(?:释放(?:了)?|放了|放出|放走|获释|恢复自由|你自由了|赦免(?:了)?|解除囚禁|撤销监禁|解开(?:了)?(?:镣铐|枷锁)|遣返|逐出|逐离宫廷|放逐|流放|驱逐出境|released from prison|set .{0,12} free|freed|pardoned|banished|exiled)/i },
      { reason: "sexual_intercourse_completed", pattern: completedSexualAction }
    ];
    const detected = [];
    // Deliberately starting a CK3 scheme is an executable intention, unlike an
    // ordinary future promise. Keep this narrow and require planning/operational
    // language so threats such as "I will kill you" do not start schemes.
    const schemeIntent = /(?:(?:开始|着手|决定|准备|打算|计划|部署|布置|实施|启动|设法|派人|派刺客|雇凶).{0,18}(?:拉拢|讨好|结交|交友|勾引|诱惑|追求|赢得.{0,6}芳心|谋杀|暗杀|除掉|做掉|绑架|劫持|寻找.{0,6}把柄|捏造.{0,6}把柄|制造.{0,6}把柄|散布.{0,8}谣言)|(?:start|begin|plot|plan|prepare|deploy|send an assassin|hire an assassin).{0,24}(?:sway|befriend|seduce|romance|murder|assassinate|abduct|kidnap|fabricate a hook))/i;
    if (clauses.some((clause, clauseIndex) => schemeIntent.test(clause) && (candidateOnly || !failedAttemptMarker.test(clause) && !hypotheticalMarker.test(clause) && !(clauseIndex > 0 && hypotheticalMarker.test(clauses[clauseIndex - 1]))))) {
      detected.push("scheme_start");
    }
    if ((candidateOnly ? completedSexualAction.test(text) : describesCompletedOrCurrentAction(completedSexualAction, true))) detected.push("sexual_intercourse_completed");
    for (const rule of rules) {
      if (rule.reason === "sexual_intercourse_completed") continue;
      if ((candidateOnly ? rule.pattern.test(text) : describesCompletedOrCurrentAction(rule.pattern, rule.reason !== "combat", rule.failurePattern))) detected.push(rule.reason);
    }
    if (candidateOnly && registry) {
      for (const action of registry.getAllActions()) {
        const semantic = action.definition?.semantic;
        const patterns = [
          ...Array.isArray(semantic?.candidatePatterns) ? semantic.candidatePatterns : [],
          ...Array.isArray(semantic?.evidencePatterns) ? semantic.evidencePatterns.filter((pattern) => ![".+", ".*", "[\\s\\S]+", "[\\s\\S]*"].includes(pattern.source)) : []
        ];
        const categories = action.definition?.triggerCategories;
        if (patterns.length === 0 || !Array.isArray(categories)) continue;
        const excluded = Array.isArray(semantic?.excludePatterns) && semantic.excludePatterns.some((pattern) => {
          pattern.lastIndex = 0;
          return pattern.test(text);
        });
        if (excluded) continue;
        if (patterns.some((pattern) => {
          pattern.lastIndex = 0;
          return pattern.test(text);
        })) detected.push(...categories);
      }
    }
    return Array.from(new Set(detected));
  }

module.exports = { detect };
