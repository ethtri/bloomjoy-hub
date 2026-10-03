# Bloomjoy 财务团队使用指南

更新日期：2026 年 10 月 2 日。截图为示例数据，并非公司实际业绩。请登录后打开链接。指南保留英文界面名称，方便在页面中查找。

## 1. 从 Finance 开始

[打开 Finance 财务报表](https://app.bloomjoyusa.com/portal/reports?view=finance)

![Finance 汇总 - 示例数据](assets/finance-core.png)

- 选择 **Period**（期间）和 **Location**（地点）。在 **More filters**（更多筛选）中选择机器。销售使用各机器所在地的业务日期。如果链接未指定日期，初始期间为最近七个完整日，不含今天。
- 依次查看 **Sales excluding tax**（不含税销售额）、**Refund deductions**（退款扣减）和 **Net sales**（净销售额）。示例为 $150.00 - $16.00 = $134.00。净销售额是报表计算值，不是利润，也不是银行到账金额。
- 向下查看 **By machine**（按机器），点击机器名称可查看同一期间的该机器报表。**Save view** 将筛选条件保存在当前浏览器的本账号下，并不保存固定版本的报表数据。
- **Export CSV** 导出所选期间及范围的 Finance 数据。金额列为整数 **cents（美分）**：12345 表示 $123.45。显示美元时除以 100，并保留文件中的日期、范围和数据覆盖说明。

常用链接：[Sales 销售明细](https://app.bloomjoyusa.com/portal/reports?view=sales) | [Refund reports 退款报表](https://app.bloomjoyusa.com/refunds?view=reports) | [Timekeeping reports 工时报表](https://app.bloomjoyusa.com/portal/time-review?view=reports)

电脑端 Reporting 标签为 **Overview**、**Sales**、**Finance**、**Locations** 和 **Partners**，按账号权限显示。手机端使用 **Report** 下拉框。链接不会授予权限；刷新后仍缺少预期的 Finance 权限时，请联系报表管理员核查。

---

## 2. 看懂 Finance 的构成

在 Finance 中展开 **Sales, tax and refund breakdown**（销售、税额及退款明细）。

![Finance 构成明细 - 示例数据](assets/finance-breakdown.png)

- **Refund deductions** = 申请扣减 - 冲回 + 按支付时点扣减的历史退款。示例为 $15.00 - $2.00 + $3.00 = $16.00。退款申请只扣减一次；冲回恢复已扣减金额。之后支付退款或发放礼品卡，不再重复扣减销售额。
- **Money refunds paid in period** 是已记录的现金或卡退款。礼品卡的 **purchase value resolved**（解决的购买金额）、**face value issued**（发卡面值）和 **Bloomjoy-funded goodwill**（Bloomjoy 承担的额外补偿）分别显示。示例中，$10.00 礼品卡解决 $5.00 购买金额，另含 $5.00 额外补偿。
- **Outstanding at [date]** 是所选期间结束时的未解决余额。退款支付使用已记录的会计日期；礼品卡使用发放日期。这些数值不代表银行结算或礼品卡已兑换。
- **Reporting tax removed** 是报表计算中的税额调整，并不能证明已收税额或应缴税额。有些计算可能是估算。Machine Reporting 中按日期设置的税务处理仅影响报表；查看报表不需要修改这些设置。

---

## 3. 选择日期并比较销售

[打开 Overview 总览](https://app.bloomjoyusa.com/portal/reports?view=overview)

![Overview 筛选条件 - 示例数据](assets/filters.png)

- 打开 **Period**，选择预设期间或 **Custom range...**（自定义）。自定义日期填写 **From**（开始）和 **Through**（截至），再点 **Apply dates**。两个端点日期均计入。Finance、Overview、Locations、退款报表和工时报表每次支持最多 367 天。包含今天的期间可能尚未完整。
- 选择 **Location**，在 **More filters** 中选 **Machine**。切换地点会清除机器选择。在 Overview 和 Locations 中，**Payment method**（支付方式）只筛选销售。解读数字前先核对当前筛选条件。
- Overview 和 Locations 提供 **Compare**：**Previous period**（上一等长期间）、**Same days, prior month**（上月对应日期）、**Same dates, prior year**（去年相同日期）或 **No comparison**（不比较）。核对筛选栏下方的实际比较日期。Finance 没有比较选择框；Sales 使用自己的明细控制项。
- 比较期间缺少数据或长度不同，可能显示 **Not comparable**（不可比较）。百分比变化要求上一期间金额大于零。机器只在一个期间有记录，不能证明该机器是新安装或已移除。

---

## 4. 使用 Sales 查看销售明细

[打开 Sales](https://app.bloomjoyusa.com/portal/reports?view=sales)

![Sales 明细控制项 - 示例数据](assets/sales.png)

- 在 **Operator performance** 报表中设置 **Date range**（日期范围）和 **Machine**。需要具体日期时，选择自定义范围并填写日期。核对控制项下方的筛选摘要。
- 打开 **More filters**，设置 **Group results by**（分组方式：Daily 每日、Weekly 每周或 Monthly 每月）和 **Payment scope**（支付范围）。Sales 使用这些控制项，而不是 Overview 的比较框。
- 查看销售汇总、期间明细和趋势。向下找到 **Detailed breakdown**，点击 **View details** 展开机器及支付方式明细。使用 **Export polished PDF** 导出当前销售报表。
- 在统一销售口径下，销售和退款影响均不含税；退款支付只是说明信息，不应再次扣减。如果历史记录使用不同口径，或金额显示不可用，先阅读标签和数据覆盖说明，再与 Finance 比较。销售记录不能证明机器持续正常运行。
- **Overview/Locations：Export PDF** 导出销售 PDF；**Download briefing** 导出文字摘要。这些导出与 Finance CSV 不同。每次导出前，核对当前页面的筛选条件。

---

## 5. 查看退款解决情况和余额

[打开 Refund reports](https://app.bloomjoyusa.com/refunds?view=reports)

![期间收到的申请 - 示例数据](assets/refunds-core.png)

- 设置 **Period**、**Location**，并在 **More filters** 中选 **Machine**。退款报表位于 **Refunds** 中，不在中央 Reporting 标签栏中。从 Overview 点击 **View reports in Refunds**，会带入所选日期、地点和机器范围。
- **Requests received in this period** 跟踪所选日期内收到的申请：申请购买金额、截至期末的解决金额及剩余余额。重复申请只计一次；申请本身不能证实购买失败。
- **Activity recorded in this period** 按退款支付、礼品卡发放和会计变更各自的日期统计，也可能包含以前收到的申请。退款金额、礼品卡解决的购买金额、礼品卡面值和额外补偿各有含义；不要全部相加作为现金支付，也不要再从净销售额扣减。
- **Outstanding across all requests** 查看截至期末、所有可用申请历史中的未解决余额，不限于本期新申请。**Report details** 说明日期、缺失数据和历史扣减。使用 **Export CSV** 导出明细。如果授权机器范围不同，Finance 与退款报表的汇总也可能不同。
- CSV 中请核对 **Unit** 和列名：金额为 USD cents，其他数值为计数。**Unavailable** 不是零；**Known subtotal** 只包含可计算金额。未知余额是被排除，并不代表已支付。对账时不要把不可用金额改为零。

---

## 6. 在 Timekeeping 中查看工时

[打开 Timekeeping reports](https://app.bloomjoyusa.com/portal/time-review?view=reports)

![Timekeeping 工时报表 - 示例数据](assets/labor.png)

- 打开 **Timekeeping**，再选择 **Reports**，或直接使用上方链接。从 Overview 点击 **View labor in Timekeeping** 会带入所选日期、地点和机器范围。按需选择 **Period**、**Location** 和 **Machine**。
- **Recorded hours** 是已记录工时；**Time entries** 是记录条数；**Paid shifts** 将每条工时记录单独向上取整到整数小时（不足一小时的部分按一小时计）。因此三条各 20 分钟的记录，总计一小时工时、三个计薪班次。记录条数不代表现场访问次数或人员利用率。
- 向下查看地点及机器的每周工时。有薪酬查看权限时才显示 **Authorized account earnings**；请阅读估算、计算就绪状态和分配说明。薪酬结算单已发布并不代表款项已支付。未分配到机器的其他报酬不是机器级成本，也不会自动从 Finance 净销售额扣减。
- 使用 **Export CSV** 导出工时。若有 **Open Pay Report** 按钮，可打开所选开始日期月份的薪酬报表。缺少工时记录，不能证明没有开展工作。
- Timekeeping CSV 区分分钟、小时、计薪班次和收入美分，不能混用单位。

**报表不完整时：** 加载失败请用 **Retry** 或 **Try again**；结果为空请核对日期、地点和机器。阅读 Reporting 的 **Data coverage and metric definitions** 或退款报表的 **Report details**。最近有导入记录，并不证明所有供应商、机器和日期的数据完整。

使用导出前，请核对期间、授权范围、单位和数据覆盖说明。如果差异仍存在，将报表页面、日期及机器/地点提供给负责报表的团队；一般截图中不要包含客户或支付隐私信息。
