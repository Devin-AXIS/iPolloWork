# Organization resources

Organization Space and the Work account dashboard use the same organization records and membership. The built-in Work features from iPolloOS are implemented in the account service. The desktop sidebar opens the organization directly.

| Requirement | Current behavior |
| --- | --- |
| Join with a service address and invitation code | Under Members, an administrator generates a single-use employee code or downloads the CSV template and imports a roster. Employee codes never expire by default. An administrator can change the expiration of an unused code in the member list. Redeeming a code adds an ordinary member to the existing organization. Existing email-bound invitations keep their original rules. |
| Simple roles and membership | Ordinary members and administrators are the two displayed roles. Administrators edit names, unique employee numbers, department assignment and membership status. Suspension pauses access without deleting membership or assignments. The affected member receives a desktop notice and can review changes under Membership notices, including after suspension. |
| Departments and permissions | Departments can have a parent. Administrators can grant resources to all members, individuals or departments, with an option to include descendants. |
| Templates, plugins and Skills | The organization accepts versioned HTML templates, exact DSH package references and Markdown Skills. Members submit versions. Administrators approve, publish, change access or unpublish while keeping the version history. Template previews run in a sandbox. Approved and granted Skills enter the DSH skill registry. Shared plugin installation uses the native Plugin Manager, which inspects the package and requests confirmation. |
| MCP | Administrators publish, edit, enable and revoke MCP entries and control access. An MCP entry can use a server key or require each member to sign in through OAuth with PKCE. DSH loads the authorized tool through the existing organization service proxy. The desktop MCP page offers organization resources, the native personal settings and the iPolloCloud public catalog. A public OAuth entry added to an organization needs its provider OAuth URLs and a public client ID configured by an administrator. |
| Collaboration, activity and settings | Organization Space lists the native DSH conversations that are shared with the current account. Administrators see organization activity and edit the name, description and logo. |

## November 13 verification

Work commits 884d31cf21, e108fda087, 349dc900a8 and f3f6d38846 and the iPolloOS Work service commit e7991db were the migration references. The Work account service owns the CSV invitation, employee directory, review and authorization flows, with role descriptions localized at the client. The organization view uses native DSH collaboration and keeps the existing model and stream error guidance. OS control-plane accounts, device operations and model deployment remain OS functions. The migration adds PostgreSQL schema version 15.
## Access

Skills and enterprise models each have one audience: everyone, or chosen departments and members. Owners and administrators can always use every asset. The account service stores audiences in `enterprise_grants` and checks them on reads and model calls. A new asset is available to everyone until its audience is narrowed. Deleting a department unassigns its members and removes its grants; removing a member removes their individual grants.

The Departments tab lists departments on the left. The selected department shows its members and one switch per skill and model. A switch adds or removes that department from the asset's audience. Assets available to everyone show a locked switch.

## Skills

Managers write a skill's name, a one-sentence routing description and its Markdown instructions, or import a Markdown file whose front matter supplies the name and description. The account service returns the skills each member may use from `GET /api/v1/me/enterprise-skills`. The suite Host registers them as runtime skills in the native skill registry after sign-in, sign-out and any skill, grant, member or department change. A skill's DSH name is its kebab-case title, or `team-skill-` plus an id prefix for titles without ASCII letters; same-name skills from different enterprises receive numeric suffixes.

## Enterprise models

Managers connect an OpenAI-compatible endpoint with the enterprise's own key. The editor offers provider presets, tests the address and key, lists the provider's models and sends a one-token chat completion. Enterprise models are stored beside official services and owned through `enterprise_services`. Their calls use the enterprise key, follow the model's audience and record zero points. Official administration cannot list or overwrite them. Granted members see them in the native model picker as `<enterprise> · <title>`.

Enterprise endpoints must be public HTTPS hosts. Loopback endpoints are accepted only when the account service itself runs on a loopback origin for development. Host names that resolve to private addresses are not rejected; deployments that expose internal HTTPS services should restrict outbound traffic from the account service.
