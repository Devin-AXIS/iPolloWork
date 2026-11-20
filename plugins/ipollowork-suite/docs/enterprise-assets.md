# Organization resources

Organization Space and the Work account dashboard use the same organization records and membership. The built-in Work features from iPolloOS are implemented in the account service. The desktop sidebar opens the organization directly.

| Requirement | Current behavior |
| --- | --- |
| Join with a service address and invitation code | Under Members, an administrator generates a single-use employee code or downloads the CSV template and imports a roster. Employee codes never expire by default. An administrator can change the expiration of an unused code in the member list. Redeeming a code adds an ordinary member to the existing organization. Existing email-bound invitations keep their original rules. |
| Simple roles and membership | Ordinary members and administrators are the two displayed roles. Administrators edit names, unique employee numbers, department assignment and membership status. Suspension pauses access without deleting membership or assignments. The affected member receives a desktop notice and can review changes under Membership notices, including after suspension. |
| Departments and permissions | Departments can have a parent. Administrators can grant resources to all members, individuals or departments, with an option to include descendants. |
| Templates, plugins and Skills | The organization accepts versioned HTML templates, exact DSH package references and Markdown Skills. Members submit versions. Administrators review, choose recipients and publish, change access or unpublish while keeping the version history. Template previews run in a sandbox. Published and granted Skills enter the DSH skill registry. Shared plugin installation uses the native Plugin Manager, which inspects the package and requests confirmation. |
| MCP | The desktop organization page shows shared MCP resources and a submission area. Members submit a named public HTTPS endpoint for review. Administrators approve a version and publish it to selected people, departments or the whole organization. Administrators may configure a server key or require each member to sign in through OAuth with PKCE after publication. Changing the endpoint requires a new version. DSH loads authorized tools through the existing organization service proxy. |
| Collaboration, activity and settings | Members share a text snapshot with named colleagues. Recipients copy and continue inside a local workspace, including while the sharer is offline. Administrators can search activity by operator or employee number. Project changes refresh while the detail is open, and the organization sends notices for review decisions, scoped releases, and project contributions. |

## November 13 verification

Work commits 884d31cf21, e108fda087, 349dc900a8 and f3f6d38846 and the iPolloOS Work service commit e7991db were the migration references. The Work account service owns the CSV invitation, employee directory, review and authorization flows, with role descriptions localized at the client. The organization view uses native DSH collaboration and keeps the existing model and stream error guidance. OS control-plane accounts, device operations and model deployment remain OS functions. The migration adds PostgreSQL schema version 15.
## Access

Organization resources have one audience: everyone, or chosen departments and members. Owners and administrators can always use published resources. New template, plugin, Skill and MCP publications start with administrators only, and administrators can choose the audience before publishing. Existing grants and the defaults for directly created models are unchanged. The account service stores audiences in `enterprise_grants` and checks them on reads and uses. Deleting a department unassigns its members and removes its grants; removing a member removes their individual grants.

The Departments tab lists departments on the left. The selected department shows its members and one switch per skill and model. A switch adds or removes that department from the asset's audience. Assets available to everyone show a locked switch.

## Skills

Managers write a skill's name, a one-sentence routing description and its Markdown instructions, or import a Markdown file whose front matter supplies the name and description. The account service returns the skills each member may use from `GET /api/v1/me/enterprise-skills`. The suite Host registers them as runtime skills in the native skill registry after sign-in, sign-out and any skill, grant, member or department change. A skill's DSH name is its kebab-case title, or `team-skill-` plus an id prefix for titles without ASCII letters; same-name skills from different enterprises receive numeric suffixes.

After publication, members can open Organization Space and switch to the Skill or MCP tab to refresh their grants. In a new conversation, type `/` and select the shared Skill to load its instructions. To use a shared MCP, ask the agent to use that MCP by name. An MCP configured for member OAuth requires signing in from the MCP tab first. The desktop Host also refreshes shared Skills and MCPs in the background.

## Enterprise models

Managers connect an OpenAI-compatible endpoint with the enterprise's own key. The editor offers provider presets, tests the address and key, lists the provider's models and sends a one-token chat completion. Enterprise models are stored beside official services and owned through `enterprise_services`. Their calls use the enterprise key, follow the model's audience and record zero points. Official administration cannot list or overwrite them. Granted members see them in the native model picker as `<enterprise> · <title>`.

Enterprise endpoints must be public HTTPS hosts. Loopback endpoints are accepted only when the account service itself runs on a loopback origin for development. Host names that resolve to private addresses are not rejected; deployments that expose internal HTTPS services should restrict outbound traffic from the account service.
