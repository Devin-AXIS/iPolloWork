# Enterprise assets

The enterprise page shows member, department, file package, skill and model counts above its tabs. Owners and administrators invite colleagues from the page header.

## Access

File packages, skills and enterprise models each have one audience: everyone, or chosen departments and members. Owners and administrators can always use every asset. The account service stores audiences in `enterprise_grants` and checks them on every read, download and model call; the browser only displays them. A new asset is available to everyone until its audience is narrowed. Deleting a department unassigns its members and removes its grants; removing a member removes their individual grants.

The Departments tab lists departments on the left. The selected department shows its members, which can be added or removed in place, and one switch per file package, skill and model. A switch adds or removes that department from the asset's audience. Assets available to everyone show a locked switch.

## File packages

A package groups files of up to 24 MB each. Managers create packages, upload files by drag and drop, remove files and choose the audience. Members with access list and download files through the suite Host, which relays the account service's private storage. Members cannot upload.

## Skills

Managers write a skill's name, a one-sentence routing description and its Markdown instructions, or import a Markdown file whose front matter supplies the name and description. The account service returns the skills each member may use from `GET /api/v1/me/enterprise-skills`. The suite Host registers them as runtime skills in the native skill registry after sign-in, sign-out and any skill, grant, member or department change. A skill's DSH name is its kebab-case title, or `team-skill-` plus an id prefix for titles without ASCII letters; same-name skills from different enterprises receive numeric suffixes.

## Enterprise models

Managers connect an OpenAI-compatible endpoint with the enterprise's own key. The editor offers provider presets, tests the address and key, lists the provider's models and sends a one-token chat completion. Enterprise models are stored beside official services and owned through `enterprise_services`. Their calls use the enterprise key, follow the model's audience and record zero points. Official administration cannot list or overwrite them. Granted members see them in the native model picker as `<enterprise> · <title>`.

Enterprise endpoints must be public HTTPS hosts. Loopback endpoints are accepted only when the account service itself runs on a loopback origin for development. Host names that resolve to private addresses are not rejected; deployments that expose internal HTTPS services should restrict outbound traffic from the account service.
