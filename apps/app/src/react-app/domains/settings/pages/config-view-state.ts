export type iPolloWalkTestState = "idle" | "testing" | "success" | "error";

export type iPolloWalkConnectionState = {
  url: string;
  token: string;
  testState: iPolloWalkTestState;
  testMessage: string | null;
};

export type TokenVisibilityKey = "ipollowalk" | "client" | "owner" | "host";

type ConfigLocalState = {
  ipollowalkConnection: iPolloWalkConnectionState;
  tokenVisible: Record<TokenVisibilityKey, boolean>;
  copyingField: string | null;
};

type ConfigLocalAction =
  | { type: "serverSettings"; connection: iPolloWalkConnectionState }
  | { type: "url"; url: string }
  | { type: "token"; token: string }
  | { type: "testState"; testState: iPolloWalkTestState; testMessage: string | null }
  | { type: "toggleToken"; key: TokenVisibilityKey }
  | { type: "copyingField"; field: string | null };

export const initialConfigLocalState: ConfigLocalState = {
  ipollowalkConnection: {
    url: "",
    token: "",
    testState: "idle",
    testMessage: null,
  },
  tokenVisible: {
    ipollowalk: false,
    client: false,
    owner: false,
    host: false,
  },
  copyingField: null,
};

export function configLocalReducer(
  state: ConfigLocalState,
  action: ConfigLocalAction,
): ConfigLocalState {
  switch (action.type) {
    case "serverSettings":
      return { ...state, ipollowalkConnection: action.connection };
    case "url":
      return {
        ...state,
        ipollowalkConnection: {
          ...state.ipollowalkConnection,
          url: action.url,
          testState: "idle",
          testMessage: null,
        },
      };
    case "token":
      return {
        ...state,
        ipollowalkConnection: {
          ...state.ipollowalkConnection,
          token: action.token,
          testState: "idle",
          testMessage: null,
        },
      };
    case "testState":
      return {
        ...state,
        ipollowalkConnection: {
          ...state.ipollowalkConnection,
          testState: action.testState,
          testMessage: action.testMessage,
        },
      };
    case "toggleToken":
      return {
        ...state,
        tokenVisible: {
          ...state.tokenVisible,
          [action.key]: !state.tokenVisible[action.key],
        },
      };
    case "copyingField":
      return { ...state, copyingField: action.field };
  }
}
