package expo.modules.micropostls

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lets the app talk HTTPS and WebSocket to the till, whose certificate is self-signed.
 *
 * `setPin(hex)` sets the SHA-256 (lowercase hex) of the till's public key, taken from the pairing QR code. From then on
 * a server whose certificate has exactly that public key is trusted, whatever its address; everything else (any other
 * server, or a till with another key) goes through Android's normal certificate checks and fails if it is not signed
 * by a trusted authority. `setPin(null)` removes the pin.
 */
class MicroposTlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MicroposTls")

    // React Native applies these builders to every fetch request and every WebSocket it opens.
    OnCreate { PinnedTls.install() }

    Function("setPin") { pin: String? -> PinnedTls.pin = pin?.lowercase() }
  }
}
