package expo.modules.micropostls

import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.websocket.WebSocketModule
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient

internal object PinnedTls {
  /** SHA-256 of the till's public key (SubjectPublicKeyInfo), lowercase hex; null until paired. */
  @Volatile
  var pin: String? = null

  fun install() {
    val apply = com.facebook.react.modules.network.CustomClientBuilder { builder -> pinTo(builder) }
    NetworkingModule.setCustomClientBuilder(apply)
    WebSocketModule.setCustomClientBuilder(apply)
  }

  private fun pinTo(builder: OkHttpClient.Builder) {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    val system = factory.trustManagers.filterIsInstance<X509TrustManager>().first()

    val trust = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) =
          system.checkClientTrusted(chain, authType)

      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        if (matches(chain.firstOrNull())) return
        system.checkServerTrusted(chain, authType)
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
    }

    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf<TrustManager>(trust), null)
    builder.sslSocketFactory(context.socketFactory, trust)

    // A pinned key is the till's identity, so its address (which changes with the network) does not have to be in the certificate.
    val systemVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
    builder.hostnameVerifier { host, session ->
      val leaf = session.peerCertificates.firstOrNull() as? X509Certificate
      matches(leaf) || systemVerifier.verify(host, session)
    }
  }

  private fun matches(certificate: X509Certificate?): Boolean {
    val expected = pin ?: return false
    if (certificate == null) return false
    val hash = MessageDigest.getInstance("SHA-256").digest(certificate.publicKey.encoded)
    val actual = hash.joinToString("") { "%02x".format(it) }
    // Same length, compared without stopping at the first difference.
    return MessageDigest.isEqual(actual.toByteArray(), expected.toByteArray())
  }
}
