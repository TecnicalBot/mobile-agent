import { prepareOpenAICallbackSession } from "@/lib/local-server";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { Button } from "./ui/button";

WebBrowser.maybeCompleteAuthSession();

function base64UrlEncode(buffer: Uint8Array) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(input: string) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );

  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function Login() {
  const handleLogin = async () => {
    const redirectUri = "http://localhost:1455/auth/callback";
    const randomBytes = Crypto.getRandomBytes(32);
    const codeVerifier = base64UrlEncode(randomBytes);
    const codeChallenge = await sha256(codeVerifier);

    const state = Math.random().toString(36).slice(2);

    console.log("REDIRECT URI:", redirectUri);
    console.log("CODE VERIFIER:", codeVerifier);
    console.log("GENERATED STATE:", state);

    prepareOpenAICallbackSession(state, async (code, returnedState) => {
      console.log("AUTH CODE:", code);
      console.log("RETURNED STATE:", returnedState);

      if (returnedState !== state) {
        console.log("Invalid state");
        return;
      }

      try {
        const tokenData = await exchangeOpenAICodeForToken({
          code,
          codeVerifier,
        });

        console.log("TOKEN DATA:", tokenData);

        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;
        const idToken = tokenData.id_token;

        await SecureStore.setItemAsync("openai_access_token", accessToken);
        await SecureStore.setItemAsync("openai_refresh_token", refreshToken);

        console.log("ACCESS TOKEN:", accessToken);
        console.log("REFRESH TOKEN:", refreshToken);
        console.log("ID TOKEN:", idToken);
      } catch (error) {
        console.log("Exchange error:", error);
      }

      console.log("State matched. Now exchange token.");
    });

    const authUrl =
      "https://auth.openai.com/oauth/authorize?" +
      new URLSearchParams({
        response_type: "code",
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        redirect_uri: redirectUri,
        scope: "openid profile email offline_access",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        state,
        originator: "opencode",
      }).toString();

    console.log("AUTH URL:", authUrl);

    await WebBrowser.openBrowserAsync(authUrl);
  };

  return <Button onPress={handleLogin}>Login</Button>;
}

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";

async function exchangeOpenAICodeForToken(params: {
  code: string;
  codeVerifier: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_CLIENT_ID,
    code: params.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    console.log("Token exchange failed:", data);
    throw new Error(
      data.error_description || data.error || "Token exchange failed",
    );
  }

  return data;
}

export async function refreshOpenAIToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: OPENAI_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    console.log("Refresh failed:", data);
    throw new Error(
      data.error_description || data.error || "Token refresh failed",
    );
  }

  return data;
}
