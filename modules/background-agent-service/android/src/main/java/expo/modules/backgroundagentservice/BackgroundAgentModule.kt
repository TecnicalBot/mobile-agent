package expo.modules.backgroundagentservice

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundAgentModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackgroundAgent")

    AsyncFunction("start") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      try {
        val intent = Intent(context, BackgroundAgentService::class.java).apply {
          action = BackgroundAgentService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        Log.e("BackgroundAgent", "Failed to start service", e)
      }
      Unit
    }

    AsyncFunction("stop") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      try {
        val intent = Intent(context, BackgroundAgentService::class.java).apply {
          action = BackgroundAgentService.ACTION_STOP
        }
        context.startService(intent)
      } catch (e: Exception) {
        Log.e("BackgroundAgent", "Failed to stop service", e)
      }
      Unit
    }

    AsyncFunction("isHeld") {
      BackgroundAgentService.isActive
    }

    AsyncFunction("requestBatteryOptimizationExemption") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (!powerManager.isIgnoringBatteryOptimizations(context.packageName)) {
        try {
          val intent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            android.net.Uri.parse("package:${context.packageName}"),
          ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(intent)
        } catch (_: Exception) {
          try {
            val intent = Intent(
              Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
          } catch (_: Exception) {}
        }
      }
      Unit
    }

    AsyncFunction("requestNotificationPermission") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        try {
          val intent = Intent(
            Settings.ACTION_APP_NOTIFICATION_SETTINGS,
          ).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          context.startActivity(intent)
        } catch (_: Exception) {}
      }
    }

    AsyncFunction("hasNotificationPermission") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        ContextCompat.checkSelfPermission(
          context,
          Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
      } else {
        true
      }
    }

    AsyncFunction("setNotificationState") { state: String ->
      BackgroundAgentService.setWaitingForApproval(state == "waiting_approval")
      Unit
    }
  }
}
