import { useEffect, useMemo, useRef, useState } from 'react';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const resolveViewport = () => ({
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 720 : window.innerHeight,
});

const normalizeBox = (box = {}) => {
  const rawBox = Array.isArray(box)
    ? box
    : Array.isArray(box?.bbox)
      ? box.bbox
      : Array.isArray(box?.box)
        ? box.box
        : Array.isArray(box?.coordinates)
          ? box.coordinates
          : null;

  if (!rawBox || rawBox.length < 4) return null;

  const [firstX, firstY, thirdX, thirdY] = rawBox.map((value) => Number(value));
  if ([firstX, firstY, thirdX, thirdY].some((value) => Number.isNaN(value))) return null;

  const x1 = Math.min(firstX, thirdX);
  const y1 = Math.min(firstY, thirdY);
  const x2 = Math.max(firstX, thirdX);
  const y2 = Math.max(firstY, thirdY);

  if (x2 <= x1 || y2 <= y1) return null;

  return {
    x1,
    y1,
    x2,
    y2,
  };
};

const fitContain = (containerWidth, containerHeight, sourceWidth, sourceHeight) => {
  const safeSourceWidth = Math.max(Number(sourceWidth) || 0, 1);
  const safeSourceHeight = Math.max(Number(sourceHeight) || 0, 1);
  const safeContainerWidth = Math.max(Number(containerWidth) || 0, 1);
  const safeContainerHeight = Math.max(Number(containerHeight) || 0, 1);
  const sourceAspect = safeSourceWidth / safeSourceHeight;
  const containerAspect = safeContainerWidth / safeContainerHeight;

  if (containerAspect > sourceAspect) {
    const renderHeight = safeContainerHeight;
    const renderWidth = renderHeight * sourceAspect;
    return {
      x: (safeContainerWidth - renderWidth) / 2,
      y: 0,
      width: renderWidth,
      height: renderHeight,
    };
  }

  const renderWidth = safeContainerWidth;
  const renderHeight = renderWidth / sourceAspect;
  return {
    x: 0,
    y: (safeContainerHeight - renderHeight) / 2,
    width: renderWidth,
    height: renderHeight,
  };
};

const buildOverlayItems = (detections = {}) => {
  if (Array.isArray(detections?.annotations) && detections.annotations.length > 0) {
    return detections.annotations
      .map((annotation) => ({
        type: String(annotation?.type || annotation?.kind || 'object').toLowerCase(),
        label: annotation?.label || 'Detected object',
        confidence: Number(annotation?.confidence || 0),
        box: normalizeBox(annotation),
      }))
      .filter((annotation) => annotation.box);
  }

  const faceBoxes = Array.isArray(detections?.faceBoxes) ? detections.faceBoxes : [];
  const phoneBoxes = Array.isArray(detections?.phoneBoxes) ? detections.phoneBoxes : [];

  return [
    ...faceBoxes.map((faceBox, index) => ({
      type: 'face',
      label: faceBoxes.length > 1 ? `Face ${index + 1}` : 'Face',
      confidence: Number(faceBox?.confidence || 1),
      box: normalizeBox(faceBox),
    })),
    ...phoneBoxes.map((phoneBox) => ({
      type: 'phone',
      label: 'Phone',
      confidence: Number(phoneBox?.confidence || 0),
      box: normalizeBox(phoneBox),
    })),
  ].filter((annotation) => annotation.box);
};

const getOverlayColors = (annotation, index, faceCount) => {
  if (annotation.type === 'phone') {
    return {
      stroke: '#fb7185',
      fill: 'rgba(251, 113, 133, 0.12)',
      tag: '#fef2f2',
    };
  }

  if (annotation.type === 'face') {
    if (faceCount > 1 && index > 0) {
      return {
        stroke: '#f97316',
        fill: 'rgba(249, 115, 22, 0.12)',
        tag: '#fff7ed',
      };
    }

    return {
      stroke: '#22c55e',
      fill: 'rgba(34, 197, 94, 0.12)',
      tag: '#ecfdf5',
    };
  }

  return {
    stroke: '#38bdf8',
    fill: 'rgba(56, 189, 248, 0.12)',
    tag: '#e0f2fe',
  };
};

const attachStreamToVideo = (video, stream, onReady) => {
  if (!video) return () => {};

  if (!stream) {
    video.srcObject = null;
    return () => {};
  }

  if (video.srcObject !== stream) {
    video.srcObject = stream;
    console.log('[CameraMonitoringLayer] Stream attached to video element');
  }

  const attemptPlayback = () => {
    const playback = video.play?.();
    if (playback?.catch) {
      playback.catch((error) => {
        console.error('[CameraMonitoringLayer] Video play failed:', error);
      });
    }
  };

  let readyHandled = false;
  const handleReady = () => {
    if (readyHandled) return;
    readyHandled = true;
    console.log('[CameraMonitoringLayer] Video ready, attempting to play');
    onReady?.();
    attemptPlayback();
  };

  attemptPlayback();

  if (video.readyState >= 2) {
    handleReady();
    return () => {};
  }

  video.addEventListener('loadeddata', handleReady);
  video.addEventListener('canplay', handleReady);
  video.addEventListener('playing', handleReady);
  return () => {
    video.removeEventListener('loadeddata', handleReady);
    video.removeEventListener('canplay', handleReady);
    video.removeEventListener('playing', handleReady);
  };
};

export default function CameraMonitoringLayer({
  stream,
  captureVideoRef,
  detections = null,
  frameSize = null,
  hidden = false,
  width = 400,
  height = 300,
}) {
  const previewVideoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState(() => {
    const viewport = resolveViewport();
    return {
      x: Math.max(12, viewport.width - (width + 24)),
      y: Math.min(88, Math.max(12, viewport.height - height - 12)),
    };
  });
  const [dragging, setDragging] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const overlayItems = useMemo(() => buildOverlayItems(detections), [detections]);
  const faceCount = overlayItems.filter((item) => item.type === 'face').length;
  const overlaySummary = useMemo(() => {
    if (overlayItems.length === 0) {
      return 'Monitoring camera feed';
    }

    const faceLabel = faceCount === 0
      ? 'No face'
      : faceCount === 1
        ? '1 face'
        : `${faceCount} faces`;
    const phoneCount = overlayItems.filter((item) => item.type === 'phone').length;
    const phoneLabel = phoneCount > 0 ? `${phoneCount} phone${phoneCount > 1 ? 's' : ''}` : 'no phone';

    return `${faceLabel} • ${phoneLabel}`;
  }, [faceCount, overlayItems.length]);

  useEffect(() => {
    setPreviewReady(false);
    console.log('[CameraMonitoringLayer] Stream changed:', !!stream);
  }, [stream]);

  useEffect(() => {
    console.log('[CameraMonitoringLayer] Attaching stream to capture video ref:', !!captureVideoRef?.current);
    return attachStreamToVideo(captureVideoRef?.current, stream);
  }, [captureVideoRef, stream]);

  useEffect(
    () => {
      console.log('[CameraMonitoringLayer] Attaching stream to preview video ref:', !!previewVideoRef.current);
      return attachStreamToVideo(previewVideoRef.current, stream, () => {
        console.log('[CameraMonitoringLayer] Preview video ready');
        setPreviewReady(true);
      });
    },
    [stream]
  );

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const video = previewVideoRef.current;
    const container = containerRef.current;

    if (!canvas || !video || hidden) return undefined;

    const drawOverlay = () => {
      const containerWidth = container?.clientWidth || width;
      const containerHeight = container?.clientHeight || height;
      const dpr = window.devicePixelRatio || 1;
      const canvasWidth = Math.max(1, Math.round(containerWidth * dpr));
      const canvasHeight = Math.max(1, Math.round(containerHeight * dpr));

      if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
      if (canvas.height !== canvasHeight) canvas.height = canvasHeight;

      const context = canvas.getContext('2d');
      if (!context) return;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, containerWidth, containerHeight);

      const sourceWidth = Number(frameSize?.width || video.videoWidth || 0);
      const sourceHeight = Number(frameSize?.height || video.videoHeight || 0);

      if (!previewReady || !sourceWidth || !sourceHeight) {
        context.save();
        context.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        context.lineWidth = 1;
        context.setLineDash([5, 5]);
        context.strokeRect(8, 8, Math.max(0, containerWidth - 16), Math.max(0, containerHeight - 16));
        context.restore();
        return;
      }

      const renderFrame = fitContain(containerWidth, containerHeight, sourceWidth, sourceHeight);
      const scaleX = renderFrame.width / sourceWidth;
      const scaleY = renderFrame.height / sourceHeight;

      context.save();
      context.strokeStyle = 'rgba(96, 165, 250, 0.2)'; // Reduced opacity for less disturbing overlay
      context.lineWidth = 1;
      context.setLineDash([4, 6]);
      context.strokeRect(renderFrame.x, renderFrame.y, renderFrame.width, renderFrame.height);
      context.restore();

      overlayItems.forEach((annotation, index) => {
        const colors = getOverlayColors(annotation, index, faceCount);
        const box = annotation.box;
        const boxX = renderFrame.x + (box.x1 * scaleX);
        const boxY = renderFrame.y + (box.y1 * scaleY);
        const boxWidth = Math.max(1, (box.x2 - box.x1) * scaleX);
        const boxHeight = Math.max(1, (box.y2 - box.y1) * scaleY);
        const label = annotation.confidence > 0
          ? `${annotation.label} ${Math.round(annotation.confidence * 100)}%`
          : annotation.label;

        context.save();
        context.shadowColor = colors.stroke;
        context.shadowBlur = 5; // Reduced shadow blur for less disturbing effect
        context.lineWidth = annotation.type === 'phone' ? 2 : 1.5; // Reduced line width
        context.strokeStyle = colors.stroke;
        context.fillStyle = colors.fill.replace('0.15', '0.05'); // Reduced fill opacity
        context.fillRect(boxX, boxY, boxWidth, boxHeight);
        context.strokeRect(boxX, boxY, boxWidth, boxHeight);
        context.shadowBlur = 0;

        const paddingX = 8;
        const paddingY = 4;
        context.font = '700 11px Arial, sans-serif';
        const labelWidth = context.measureText(label).width + (paddingX * 2);
        const tagHeight = 18;
        const tagX = clamp(boxX, 8, Math.max(8, containerWidth - labelWidth - 8));
        const tagY = clamp(boxY - tagHeight - 4, 8, Math.max(8, containerHeight - tagHeight - 8));

        context.fillStyle = colors.stroke;
        context.fillRect(tagX, tagY, labelWidth, tagHeight);
        context.fillStyle = colors.tag;
        context.fillText(label, tagX + paddingX, tagY + 12);
        context.restore();
      });

      const hasPhone = overlayItems.some((item) => item.type === 'phone');
      const hasFaceMissing = Boolean(detections?.faceMissing || faceCount === 0);
      const hasMultipleFaces = Boolean(detections?.multipleFaces || faceCount > 1);
      const bannerParts = [];
      if (hasFaceMissing) {
        bannerParts.push('Face missing');
      } else if (hasMultipleFaces) {
        bannerParts.push('Multiple faces');
      } else if (faceCount === 1) {
        bannerParts.push('Single face');
      }
      if (hasPhone) {
        bannerParts.push('Phone detected');
      }

      if (bannerParts.length > 0) {
        const bannerText = bannerParts.length > 1
          ? `Multiple issues: ${bannerParts.join(' • ')}`
          : `Detected: ${bannerParts[0]}`;
        const bannerStroke = hasFaceMissing
          ? '#ef4444'
          : hasMultipleFaces
            ? '#f97316'
            : hasPhone
              ? '#fb7185'
              : '#22c55e';

        context.save();
        context.font = '700 12px Arial, sans-serif';
        const bannerWidth = context.measureText(bannerText).width + 20;
        const bannerHeight = 24;
        const bannerX = Math.max(10, (containerWidth - bannerWidth) / 2);
        const bannerY = 10;
        context.fillStyle = 'rgba(15, 23, 42, 0.88)';
        context.fillRect(bannerX, bannerY, bannerWidth, bannerHeight);
        context.strokeStyle = bannerStroke;
        context.lineWidth = 1.5;
        context.strokeRect(bannerX, bannerY, bannerWidth, bannerHeight);
        context.fillStyle = '#f8fafc';
        context.fillText(bannerText, bannerX + 10, bannerY + 16);
        context.restore();
      }

      context.save();
      const pillText = overlaySummary;
      context.font = '700 11px Arial, sans-serif';
      const pillWidth = context.measureText(pillText).width + 18;
      const pillHeight = 22;
      context.fillStyle = 'rgba(15, 23, 42, 0.82)';
      context.fillRect(10, containerHeight - pillHeight - 10, pillWidth, pillHeight);
      context.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      context.strokeRect(10, containerHeight - pillHeight - 10, pillWidth, pillHeight);
      context.fillStyle = '#e2e8f0';
      context.fillText(pillText, 18, containerHeight - 16);
      context.restore();
    };

    drawOverlay();

    const onResize = () => drawOverlay();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [detections, faceCount, frameSize, hidden, overlayItems, overlaySummary, previewReady, width, height]);

  useEffect(() => {
    const onResize = () => {
      const viewport = resolveViewport();
      setPosition((current) => ({
        x: clamp(current.x, 12, Math.max(12, viewport.width - width - 12)),
        y: clamp(current.y, 12, Math.max(12, viewport.height - height - 12)),
      }));
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [height, width]);

  useEffect(() => {
    if (!dragging) return undefined;

    const onMove = (event) => {
      const nextX = clamp(
        event.clientX - dragOffsetRef.current.x,
        12,
        Math.max(12, window.innerWidth - width - 12)
      );
      const nextY = clamp(
        event.clientY - dragOffsetRef.current.y,
        12,
        Math.max(12, window.innerHeight - height - 12)
      );
      setPosition({ x: nextX, y: nextY });
    };

    const onUp = () => setDragging(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, height, width]);

  return (
    <>
      <video
        ref={captureVideoRef}
        autoPlay
        muted
        playsInline
        style={{ position: 'absolute', width: 320, height: 240, opacity: 0, pointerEvents: 'none', visibility: 'hidden' }}
      />
      {!hidden ? (
        <div
          ref={containerRef}
          style={{
            position: 'fixed',
            top: position.y,
            left: position.x,
            width,
            height,
            zIndex: 1100,
            borderRadius: 20,
            overflow: 'hidden',
            border: '1px solid rgba(96, 165, 250, 0.35)',
            boxShadow: '0 18px 45px rgba(2, 6, 23, 0.45)',
            background: 'rgba(2, 6, 23, 0.86)',
            userSelect: 'none',
          }}
        >
          <button
            type="button"
            onPointerDown={(event) => {
              const rect = event.currentTarget.parentElement?.getBoundingClientRect();
              dragOffsetRef.current = {
                x: event.clientX - (rect?.left || 0),
                y: event.clientY - (rect?.top || 0),
              };
              setDragging(true);
            }}
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 2,
              borderRadius: 999,
              border: '1px solid rgba(148, 163, 184, 0.26)',
              background: 'rgba(15, 23, 42, 0.76)',
              color: '#e2e8f0',
              padding: '0.35rem 0.65rem',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'grab',
              touchAction: 'none',
            }}
          >
            Drag Camera
          </button>
          <div
            style={{
              position: 'absolute',
              right: 8,
              top: 8,
              zIndex: 2,
              borderRadius: 999,
              background: 'rgba(15, 118, 110, 0.82)',
              color: '#ecfeff',
              fontSize: '0.72rem',
              padding: '0.35rem 0.55rem',
              fontWeight: 700,
            }}
          >
            Monitoring Active
          </div>
          <video
            ref={previewVideoRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#020617', visibility: 'visible', zIndex: 0, position: 'relative' }}
          />
          {!previewReady ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 3,
                display: 'grid',
                placeItems: 'center',
                padding: '1rem',
                textAlign: 'center',
                color: '#cbd5e1',
                background:
                  'linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.84))',
                fontSize: '0.8rem',
                lineHeight: 1.5,
              }}
            >
              <div>
                <strong style={{ display: 'block', color: '#eff6ff', marginBottom: '0.35rem' }}>
                  Starting camera preview
                </strong>
                Keep this window visible while monitoring starts.
              </div>
            </div>
          ) : null}
          <canvas
            ref={overlayCanvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />
        </div>
      ) : null}
    </>
  );
}
