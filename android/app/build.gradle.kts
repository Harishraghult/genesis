plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "org.focuslock.app"
    compileSdk = 35
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "org.focuslock.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes {
        debug {
            val vpnEnabled = providers.gradleProperty("ENABLE_LOCAL_VPN").getOrElse("false") == "true"
            buildConfigField("boolean", "ENABLE_LOCAL_VPN", vpnEnabled.toString())
            val bleEnabled = providers.gradleProperty("ENABLE_BLE_PRESENCE").getOrElse("false") == "true"
            buildConfigField("boolean", "ENABLE_BLE_PRESENCE", bleEnabled.toString())
            val apiUrl = providers.gradleProperty("API_BASE_URL").getOrElse("http://10.0.2.2:8000")
            require(apiUrl.matches(Regex("https?://[a-zA-Z0-9.:-]+"))) { "API_BASE_URL must be an HTTP(S) origin without a trailing slash" }
            buildConfigField("String", "API_BASE_URL", "\"$apiUrl\"")
            val resourceHosts = providers.gradleProperty("RESOURCE_ALLOWED_HOSTS").getOrElse("college.example.edu,docs.college.example.edu")
            buildConfigField("String", "RESOURCE_ALLOWED_HOSTS", "\"$resourceHosts\"")
        }
        release {
            buildConfigField("boolean", "ENABLE_LOCAL_VPN", "false")
            buildConfigField("boolean", "ENABLE_BLE_PRESENCE", "false")
            val releaseApi = providers.gradleProperty("RELEASE_API_BASE_URL").getOrElse("https://api.focuslock.invalid")
            require(releaseApi.matches(Regex("https://[a-zA-Z0-9.:-]+"))) { "Release API must be an HTTPS origin" }
            buildConfigField("String", "API_BASE_URL", "\"$releaseApi\"")
            buildConfigField("String", "RESOURCE_ALLOWED_HOSTS", "\"college.example.edu\"")
            isMinifyEnabled = false
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.navigation:navigation-compose:2.8.9")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
    implementation("androidx.camera:camera-core:1.5.3")
    implementation("androidx.camera:camera-camera2:1.5.3")
    implementation("androidx.camera:camera-lifecycle:1.5.3")
    implementation("androidx.camera:camera-view:1.5.3")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
}
