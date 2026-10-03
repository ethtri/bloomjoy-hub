# Bloomjoy Finance team guide

Updated October 2, 2026. Screenshots show illustrative sample data, not company results. Sign in to follow the live links. English screen labels are preserved in both editions.

## 1. Start with Finance

[Open Finance](https://app.bloomjoyusa.com/portal/reports?view=finance)

![Finance totals - illustrative sample data](assets/finance-core.png)

- Choose the **Period** and **Location**. Open **More filters** for a machine. Sales use each machine's local business date. With no dates in the link, the initial period is the last seven completed days.
- Read **Sales excluding tax**, **Refund deductions**, then **Net sales**. In this sample, $150.00 - $16.00 = $134.00. Net sales is a reporting amount; it is not profit or money deposited in the bank.
- Scroll to **By machine** and select a machine name to review it using the same period. **Save view** saves the filters for your account in this browser; it does not save a frozen report.
- **Export CSV** downloads Finance for the selected period and scope. Money columns are integer **cents**: 12345 means $123.45. Divide by 100 when formatting dollars in a spreadsheet. Keep the date, scope and coverage rows.

Quick links: [Sales](https://app.bloomjoyusa.com/portal/reports?view=sales) | [Refund reports](https://app.bloomjoyusa.com/refunds?view=reports) | [Timekeeping reports](https://app.bloomjoyusa.com/portal/time-review?view=reports)

Desktop Reporting tabs are **Overview**, **Sales**, **Finance**, **Locations**, and **Partners**, according to access. On a phone, use the **Report** selector. A link does not grant access; if expected Finance access remains missing after refreshing, ask the reporting administrator to check access.

---

## 2. Read the Finance breakdown

In Finance, open **Sales, tax and refund breakdown**.

![Finance breakdown - illustrative sample data](assets/finance-breakdown.png)

- **Refund deductions** = requested deductions - reversals + older refunds deducted when paid. Here, $15.00 - $2.00 + $3.00 = $16.00. Requests reduce sales once; reversals restore deductions. Later payments and gift cards do not deduct again.
- **Money refunds paid in period** shows recorded money refunds. Gift-card **purchase value resolved**, **face value issued**, and **Bloomjoy-funded goodwill** are separate: in this sample a $10.00 gift resolves a $5.00 purchase with $5.00 goodwill.
- **Outstanding at [date]** is the balance at the selected period's end. Payments use recorded accounting dates; gifts use issuance dates. These amounts do not establish bank settlement or gift redemption.
- **Reporting tax removed** adjusts the reporting calculation; it does not establish tax collected or owed. Some calculations may be estimates. Dated tax treatment in Machine Reporting affects reporting only; reading these reports does not require changing it.

---

## 3. Choose a period and compare sales

[Open Overview](https://app.bloomjoyusa.com/portal/reports?view=overview)

![Overview filters - illustrative sample data](assets/filters.png)

- Open **Period** for a preset or **Custom range...**. For custom dates, enter **From** and **Through**, then **Apply dates**. Both dates are included. Finance, Overview, Locations, Refund reports and Timekeeping reports support up to 367 days. A period including today may be partial.
- Select **Location**; open **More filters** for **Machine**. Changing location clears the machine selection. In Overview and Locations, **Payment method** filters sales only. Check active filters before interpreting totals.
- **Compare** is available in Overview and Locations: **Previous period**, **Same days, prior month**, **Same dates, prior year**, or **No comparison**. Read the comparison dates shown below the filters. Finance has no comparison selector; Sales has its own detail controls.
- Missing or unequal comparison periods may show **Not comparable**. A percentage change requires a positive prior amount. A machine with records in only one period is not proof that it was newly installed or removed.

---

## 4. Use Sales for the detail

[Open Sales](https://app.bloomjoyusa.com/portal/reports?view=sales)

![Sales detail controls - illustrative sample data](assets/sales.png)

- Set **Date range** and **Machine** in the **Operator performance** report. For specific dates, select the custom range and enter its dates. Read the filter summary directly below the controls.
- Open **More filters** to choose **Group results by** (Daily, Weekly or Monthly) and **Payment scope**. Sales uses these controls instead of the Overview comparison selector.
- Review the sales totals, period summary and trend. Scroll to **Detailed breakdown** and choose **View details** for machine and payment rows. Use **Export polished PDF** for the selected sales report.
- Under the shared sales basis, sales and refund impact exclude tax; refund payments are context, not another deduction. If older records use a different basis or an amount is unavailable, read the labels and coverage notes before comparing it with Finance. A sales row does not prove machine uptime.
- **Overview/Locations: Export PDF** creates a sales PDF; **Download briefing** creates a text summary. These exports are not the Finance CSV. Check each screen's filters before export.

---

## 5. Check refund resolution and balances

[Open Refund reports](https://app.bloomjoyusa.com/refunds?view=reports)

![Requests received - illustrative sample data](assets/refunds-core.png)

- Choose **Period**, **Location** and, under **More filters**, **Machine**. Refund reports live in **Refunds**, rather than a central Reporting tab. From Overview, **View reports in Refunds** carries the selected dates and location/machine scope.
- **Requests received in this period** follows requests received during the selected dates: their requested purchase value, resolution by period end and remaining balance. Duplicate requests count once; a request does not confirm a failed purchase.
- **Activity recorded in this period** follows the dates of payments, gift issuance and accounting changes. It can include older requests. Money refunds, gift purchase value, gift face value and goodwill describe different things; do not add them all as cash paid or deduct them again from net sales.
- **Outstanding across all requests** looks at all available request history as of period end, not only new requests in the period. **Report details** explains dates, missing records and historical deductions. Use **Export CSV** for the breakdown; Finance and Refunds totals can differ when their authorized machine scopes differ.
- In the CSV, check **Unit** and column labels: money is USD cents; other values are counts. **Unavailable** is not zero. **Known subtotal** includes only calculable amounts; an unknown balance is omitted, not assumed paid. Never replace unavailable amounts with zero in a reconciliation.

---

## 6. Find recorded labor in Timekeeping

[Open Timekeeping reports](https://app.bloomjoyusa.com/portal/time-review?view=reports)

![Timekeeping reports - illustrative sample data](assets/labor.png)

- Open **Timekeeping**, then **Reports**, or follow the link above. From Overview, **View labor in Timekeeping** carries the selected dates and location/machine scope. Choose **Period**, **Location** and **Machine** as needed.
- **Recorded hours** is recorded time. **Time entries** counts entries. **Paid shifts** rounds each entry independently to a started hour: three 20-minute entries give one recorded hour and three paid shifts. Entries are not visits or staffing utilization.
- Scroll for weekly effort by location and machine. **Authorized account earnings** appears only with pay access; read its estimate, readiness and allocation notes. Published statements do not prove payment. Unallocated other earnings are not machine-level costs and are not automatically deducted from Finance net sales.
- Use **Export CSV** for recorded labor. **Open Pay Report**, when available, opens the pay report for the selected start month. Missing entries do not prove that no work occurred.
- The Timekeeping CSV distinguishes minutes, hours, shifts and earnings cents. Keep those units separate.

**If a report looks incomplete:** use **Retry** or **Try again** for loading errors. For empty results, check dates, location and machine. Read **Data coverage and metric definitions** in Reporting or **Report details** in Refunds. Recent imports do not prove complete records across every provider, machine and date.

Before using an export: confirm the period, authorized scope, units and coverage notes. If a discrepancy remains, share the report view, dates and machine/location with the team responsible for reporting; keep private customer and payment details out of general screenshots.
