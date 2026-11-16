export const SLACK_APP_MANIFEST_YAML = `_metadata:
  major_version: 1
display_information:
  name: DeepSeek Harness
  description: Connect Slack conversations to a local DeepSeek Harness agent.
  background_color: "#4A154B"
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: DeepSeek Harness
    always_online: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - channels:history
      - files:read
      - files:write
      - groups:history
      - im:read
      - im:history
      - mpim:history
      - reactions:write
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
`;

export const SLACK_CREATE_APP_URL = 'https://api.slack.com/apps?new_app=1';
