export type iPolloWorkTestState = "idle" | "testing" | "success" | "error";

export type iPolloWorkConnectionState = {
  url: string;
  token: string;
  testState: iPolloWorkTestState;
  testMessage: string | null;
};

export type TokenVisibilityKey = "ipollowork" | "client" | "owner" | "host";

type ConfigLocalState = {
  ipolloworkConnection: iPolloWorkConnectionState;
  tokenVisible: Record<TokenVisibilityKey, boolean>;
  copyingField: string | null;
};

type ConfigLocalAction =
  | { type: "serverSettings"; connection: iPolloWorkConnectionState }
  | { type: "url"; url: string }
  | { type: "token"; token: string }
  | { type: "testState"; testState: iPolloWorkTestState; testMessage: string | null }
  | { type: "toggleToken"; key: TokenVisibilityKey }
  | { type: "copyingField"; field: string | null };

export const initialConfigLocalState: ConfigLocalState = {
  ipolloworkConnection: {
    url: "",
    token: "",
    testState: "idle",
    testMessage: null,
  },
  tokenVisible: {
    ipollowork: false,
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
      return { ...state, ipolloworkConnection: action.connection };
    case "url":
      return {
        ...state,
        ipolloworkConnection: {
          ...state.ipolloworkConnection,
          url: action.url,
          testState: "idle",
          testMessage: null,
        },
      };
    case "token":
      return {
        ...state,
        ipolloworkConnection: {
          ...state.ipolloworkConnection,
          token: action.token,
          testState: "idle",
          testMessage: null,
        },
      };
    case "testState":
      return {
        ...state,
        ipolloworkConnection: {
          ...state.ipolloworkConnection,
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
