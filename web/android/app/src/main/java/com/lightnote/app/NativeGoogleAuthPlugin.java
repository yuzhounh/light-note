package com.lightnote.app;

import android.os.CancellationSignal;

import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

@CapacitorPlugin(name = "NativeGoogleAuth")
public class NativeGoogleAuthPlugin extends Plugin {
    @com.getcapacitor.PluginMethod
    public void signIn(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String webClientId = null;
                try {
                    int resId = getActivity().getResources().getIdentifier("default_web_client_id", "string", getActivity().getPackageName());
                    if (resId != 0) {
                        webClientId = getActivity().getString(resId);
                    }
                } catch (Exception ignored) {}

                if (webClientId == null || webClientId.trim().isEmpty()) {
                    webClientId = call.getString("webClientId");
                }

                if (webClientId == null || webClientId.trim().isEmpty()) {
                    call.reject("未配置 Google 客户端 ID", "MISSING_CLIENT_ID");
                    return;
                }

                GetSignInWithGoogleOption googleOption =
                    new GetSignInWithGoogleOption.Builder(webClientId).build();
                GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(googleOption)
                    .build();
                CredentialManager credentialManager = CredentialManager.create(getActivity());

                credentialManager.getCredentialAsync(
                    getActivity(),
                    request,
                    new CancellationSignal(),
                    ContextCompat.getMainExecutor(getActivity()),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse response) {
                            Credential credential = response.getCredential();
                            if (!(credential instanceof CustomCredential)
                                || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                call.reject("Google 返回了无法识别的登录凭据", "INVALID_CREDENTIAL");
                                return;
                            }

                            try {
                                GoogleIdTokenCredential googleCredential =
                                    GoogleIdTokenCredential.createFrom(((CustomCredential) credential).getData());
                                JSObject result = new JSObject();
                                result.put("idToken", googleCredential.getIdToken());
                                call.resolve(result);
                            } catch (Exception error) {
                                call.reject("Google 登录凭据解析失败", "INVALID_ID_TOKEN", error);
                            }
                        }

                        @Override
                        public void onError(GetCredentialException error) {
                            if (error instanceof GetCredentialCancellationException) {
                                call.reject("已取消 Google 登录", "SIGN_IN_CANCELLED", error);
                            } else {
                                call.reject("无法完成 Google 登录：" + error.getLocalizedMessage(), "NATIVE_SIGN_IN_FAILED", error);
                            }
                        }
                    }
                );
            } catch (Exception error) {
                call.reject("无法启动 Google 登录：" + error.getLocalizedMessage(), "NATIVE_SIGN_IN_FAILED", error);
            }
        });
    }

    @com.getcapacitor.PluginMethod
    public void clearCredentialState(PluginCall call) {
        CredentialManager credentialManager = CredentialManager.create(getActivity());
        credentialManager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            null,
            ContextCompat.getMainExecutor(getActivity()),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) {
                    call.resolve();
                }

                @Override
                public void onError(ClearCredentialException error) {
                    call.reject("无法清除 Google 登录状态", "CLEAR_CREDENTIAL_FAILED", error);
                }
            }
        );
    }
}
