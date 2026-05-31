# Links
- workshop hands-on: https://amzn-chn.feishu.cn/wiki/JlrwwDoS2iXl4Mk7Q1FcdwbQnJd

# Prompts

## User Need Analysis Input
### Step 1.1
```
你的角色：你是一位专业的产品经理，负责创建定义明确的用户故事，这些用户故事将成为开发系统的契约，具体内容如
下面任务部分所述。请为接下来的工作制定计划，并在需求计划文件requirements_plan.md中写下你的步骤，
为每个步骤添加复选框。如果任何步骤需要我的澄清，请用 [Question] 标签添加问题，
并创建 [Answer] 标签，下面提供多个你认为的最佳选项和一个其他供我填写其他答案。
如果某个问题我的回答不清楚，请在requirements_plan.md原问题处添加Updated字样追加问题，
并通知我。此外你可以在requirements_plan.md追加问题，通过多轮迭代，直到你全面明白我的意图。
同时为了便于后续的步骤，你也要提出非功能性需求的一些问题。
不要自行做出关键决策。完成计划后，请求我审查和批准。在我批准后，
你可以按照计划逐步执行，并输出中文的需求文档。每完成一个步骤，在计划中将相应的复选框标记为已完成。

你的任务：根据产品描述中所述的高层级需求，在Spec中创建Requirements。

##产品描述：

构建一个名为 AWSomeShop 的内部员工福利电商网站。
该项目旨在通过最小可行产品（MVP）来验证员工积分兑换系统的商业模式。

##核心功能：
- 员工：
  -  可以使用"AWSome积分"浏览和兑换预选产品。
  -  可以查看积分余额和兑换历史。
- 管理员：
  -  可以手动配置产品信息。
  -  可以手动管理员工"AWSome积分"（发放和扣除）。
```

```
Your Role: You are a professional product manager responsible for creating well-defined user stories that will form the contract for developing the system, as described in the tasks section below. Please plan your work for the upcoming steps and write them down in the requirements plan file `requirements_plan.md`, adding checkboxes for each step. If any step requires clarification from me, please add a question using the `[Question]` tag, and create an `[Answer]` tag with several options you deem best and one alternative for me to fill in.

If my answer to a question is unclear, please add an "Updated" comment to the original question in `requirements_plan.md` and notify me. You can also add questions to `requirements_plan.md` through multiple iterations until you fully understand my intent.

To facilitate subsequent steps, you should also raise some questions regarding non-functional requirements.

Do not make key decisions on your own. After completing the plan, request my review and approval. Once approved, you can execute the plan step by step and output an English requirements document. Mark the corresponding checkbox in the plan as completed after each step.

Your task: Create Requirements in the Spec based on the high-level requirements described in the product description.

##Project Description##

Build ...

This project aims to ...

##Core Functionality##

- Employees:

    - Can...
    - Can...

- Administrators:
    - 
    - 
```

### Step 1.2
```
我已经在[Answer]回答了问题，是否还有其他问题需要我澄清的在requirements_plan.md追加问题。
```

```
I have already answered the question in [Answer]. If there are any other questions that I need to clarify, please add them to requirements_plan.md.
```



## Design

### Step 2.1

```
设计阶段需要你提设计的问题，并在设计计划文件design_plan.md中写下你的步骤，为每个步骤添加复选框。
如果任何步骤需要我的澄清，请用 [Question] 标签添加问题，并创建 [Answer] 标签，下面提供多个你认为的最佳选项和一个其他供我填写其他答案。
如果某个问题我的回答不清楚，请在design_plan.md中原问题处添加Updated字样追加问题，并通知我。
此外你可以在design_plan.md中追加问题，通过多轮迭代，直到你全面明白我的意图。不要自行做出关键决策。
完成计划后，请求我审查和批准。在我批准后，你可以按照计划逐步执行。
每完成一个步骤，在计划中将相应的复选框标记为已完成。
```

```
During the design phase, you need to raise design questions and write down your steps in the design plan file `design_plan.md`, adding checkboxes for each step.

If any step requires clarification from me, please add a question using the `[Question]` tag and create an `[Answer]` tag, providing several options you consider best and one alternative for me to fill in additional answers.

If my answer to a question is unclear, please add an "Updated" comment to the original question in `design_plan.md` and notify me.

Additionally, you can add questions to `design_plan.md`, iterating through multiple rounds until you fully understand my intent. Do not make key decisions on your own.

After completing the plan, request my review and approval. Once approved, you can execute the plan step by step.

For each completed step, mark the corresponding checkbox in the plan as completed.
```

---

### Step 2.2

```
我已经在[Answer]回答了问题，是否还有其他问题需要我澄清在design_plan.md追加问题?
```

```
I've already answered the question in the [Answer] section. Are there any other questions I need to clarify? Please add them to design_plan.md.
```

---

## Step 3.1
```
在任务划分的时候，要注意任务之前的依赖关系，将可以并行执行的任务进行分组，并标注这些可以并行执行的任务组，以便可以将这些任务并行处理，减短交付时间。
```

```
When dividing tasks, pay attention to the dependencies between tasks, group tasks that can be executed in parallel, and mark these task groups so that these tasks can be processed in parallel and delivery time can be shortened.
```