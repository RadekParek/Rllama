package app.rllama;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Registered before the bridge starts so the web layer can call it on load.
    registerPlugin(RllamaNativePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
