package expo.modules.htmlvideoexport

import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.nio.ByteBuffer

/**
 * Concatenates same-encoding MP4 segments (produced by one encoder
 * configuration) by sample-copy remuxing: no decode, no re-encode, no
 * quality loss. Presentation timestamps offset per segment so playback is
 * continuous. Audio and video tracks both carry over when present.
 *
 * Throws when inputs are missing, track sets differ, or a segment cannot
 * be read — callers retry or fail the segment, never ship a partial file.
 */
object SegmentConcat {
  private const val BUFFER_SIZE = 1024 * 1024
  private const val MAX_INPUTS = 32

  fun concat(inputPaths: List<String>, outputPath: String) {
    if (inputPaths.isEmpty() || inputPaths.size > MAX_INPUTS) {
      throw IllegalArgumentException("Need 1–32 segments to concatenate.")
    }
    if (inputPaths.size == 1) {
      // Single segment: plain copy, same result without remux risk.
      val src = java.io.File(inputPaths[0])
      if (!src.isFile) throw IllegalStateException("Segment file is missing.")
      src.copyTo(java.io.File(outputPath), overwrite = true)
      return
    }
    var muxer: MediaMuxer? = null
    try {
      muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      // Per output track: muxer index + running timestamp offset.
      data class TrackSlot(var muxIndex: Int, var offsetUs: Long, var mime: String)
      var slots: MutableList<TrackSlot>? = null
      var muxerStarted = false
      // The output video track carries ONE set of H.264 parameter sets
      // (SPS/PPS in the `avcC` record) and one frame size, taken from the
      // FIRST segment. Every later segment must therefore match them: a
      // segment encoded with different parameters (an encoder switch, or a
      // stale cache file at another resolution) would sample-copy into that
      // track and desync the decoder (blocky/green garbage) instead of
      // failing. Compare and fail loud.
      var refVideo: MediaFormat? = null

      fun compareVideo(index: Int, format: MediaFormat) {
        val ref = refVideo ?: run { refVideo = format; return }
        fun csdOf(source: MediaFormat): Triple<Int, Int, ByteArray> {
          val w = source.getInteger(MediaFormat.KEY_WIDTH)
          val h = source.getInteger(MediaFormat.KEY_HEIGHT)
          val bytes = copyCodecSpecificData(source.getByteBuffer("csd-0"), source.getByteBuffer("csd-1"))
          return Triple(w, h, bytes)
        }
        val refV = csdOf(ref)
        val seg = csdOf(format)
        if (refV.first != seg.first || refV.second != seg.second) {
          throw IllegalStateException(
            "Segment ${index + 1} resolution ${seg.first}x${seg.second} differs from segment 1 " +
              "${refV.first}x${refV.second} (a stale render-cache file from a different scene size). " +
              "Delete the render cache and re-run the export.",
          )
        }
        if (!refV.third.contentEquals(seg.third)) {
          throw IllegalStateException(
            "Segment ${index + 1} was encoded with different H.264 parameters (SPS/PPS) than " +
              "segment 1 (an encoder switch mid-run). Delete the render cache and re-run the export.",
          )
        }
      }

      for ((segmentIndex, path) in inputPaths.withIndex()) {
        val extractor = MediaExtractor()
        try {
          extractor.setDataSource(path)
          val selected = mutableListOf<Pair<Int, MediaFormat>>()
          for (i in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(i)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("video/") || mime.startsWith("audio/")) {
              selected.add(Pair(i, format))
              if (mime.startsWith("video/")) compareVideo(segmentIndex, format)
            }
          }
          if (selected.isEmpty()) {
            throw IllegalStateException("Segment has no audio or video track.")
          }
          if (slots == null) {
            slots = selected.map { (_, format) ->
              val mime = format.getString(MediaFormat.KEY_MIME)!!
              TrackSlot(muxer.addTrack(format), 0L, mime)
            }.toMutableList()
            muxer.start()
            muxerStarted = true
          } else {
            if (selected.size != slots.size) {
              throw IllegalStateException("Segment track layout differs; cannot concatenate.")
            }
            for ((slot, sel) in slots.zip(selected)) {
              val mime = sel.second.getString(MediaFormat.KEY_MIME)
              if (mime != slot.mime) {
                throw IllegalStateException("Segment codec differs; cannot concatenate.")
              }
              extractor.selectTrack(sel.first)
            }
          }
          // (Re)select for the first input, which skipped the loop above.
          for (sel in selected) {
            extractor.selectTrack(sel.first)
          }
          val current = slots ?: throw IllegalStateException("Segment track layout differs; cannot concatenate.")
          val buffer = ByteBuffer.allocateDirect(BUFFER_SIZE)
          val info = android.media.MediaCodec.BufferInfo()
          // Track the true end timestamp per slot for the next offset: the
          // last sample's PTS plus one sample duration. Using the PTS alone
          // makes the next segment start on top of the previous segment's
          // final frame — duplicate timestamps make the muxer drop a frame at
          // every seam and shorten the finished file.
          val ends = LongArray(current.size) { 0L }
          val prevPts = LongArray(current.size) { Long.MIN_VALUE }
          val lastDelta = LongArray(current.size) { 0L }
          var sawFrame = false
          while (true) {
            val trackIndex = extractor.sampleTrackIndex
            if (trackIndex < 0) break
            val slotIdx = selected.indexOfFirst { it.first == trackIndex }
            if (slotIdx < 0) {
              extractor.advance()
              continue
            }
            info.offset = 0
            info.size = extractor.readSampleData(buffer, 0)
            if (info.size < 0) break
            val pts = extractor.sampleTime + current[slotIdx].offsetUs
            if (prevPts[slotIdx] != Long.MIN_VALUE && pts > prevPts[slotIdx]) {
              lastDelta[slotIdx] = pts - prevPts[slotIdx]
            }
            prevPts[slotIdx] = pts
            info.presentationTimeUs = pts
            info.flags = extractor.sampleFlags
            muxer.writeSampleData(current[slotIdx].muxIndex, buffer, info)
            val end = pts + lastDelta[slotIdx]
            if (end > ends[slotIdx]) {
              ends[slotIdx] = end
            }
            sawFrame = true
            extractor.advance()
          }
          if (!sawFrame) {
            throw IllegalStateException("Segment contained no frames.")
          }
          for (i in current.indices) {
            // Next segment starts just after this one ends. The +1 keeps PTS
            // strictly increasing even for a single-sample segment, whose
            // duration is still unknown.
            if (ends[i] >= current[i].offsetUs) {
              current[i].offsetUs = ends[i] + 1
            }
          }
        } finally {
          try { extractor.release() } catch (_: Exception) {}
        }
      }
      if (!muxerStarted) {
        throw IllegalStateException("Nothing was muxed.")
      }
    } finally {
      try { muxer?.stop() } catch (_: Exception) {}
      try { muxer?.release() } catch (_: Exception) {}
    }
  }
}
