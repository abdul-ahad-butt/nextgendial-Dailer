import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  status: 'offline' | 'available' | 'ringing' | 'active' | 'break' | 'wrap_up' | 'on_call';
}

export const TelephonyVisualizer3D: React.FC<VisualizerProps> = ({ status }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let angle = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      const isCallActive = status === 'active' || status === 'on_call';
      const isRinging = status === 'ringing';
      const isAvailable = status === 'available';
      const isBreak = status === 'break';
      const isWrapUp = status === 'wrap_up';

      const radius = isCallActive ? 36 : isRinging ? 32 : isAvailable ? 28 : 24;

      angle += isCallActive ? 0.06 : isRinging ? 0.09 : isAvailable ? 0.025 : 0.01;

      // Color scheme based on state
      const color = isCallActive
        ? '#10B981'
        : isRinging
        ? '#F59E0B'
        : isAvailable
        ? '#06B6D4'
        : isBreak
        ? '#818CF8'
        : isWrapUp
        ? '#FBBF24'
        : '#64748B';

      // 3D Orbital Rings simulation
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle + (i * Math.PI) / 3);
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * 0.45, (i * Math.PI) / 4, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = isCallActive ? 2 : 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = isCallActive || isRinging ? 14 : isAvailable ? 8 : 4;
        ctx.stroke();
        ctx.restore();
      }

      // Outer particle ring for active calls
      if (isCallActive || isRinging) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(-angle * 1.5);
        for (let p = 0; p < 8; p++) {
          const particleAngle = (p * Math.PI) / 4;
          const px = Math.cos(particleAngle) * (radius + 6);
          const py = Math.sin(particleAngle) * (radius * 0.6);
          ctx.beginPath();
          ctx.arc(px, py, 1.8, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
          ctx.fill();
        }
        ctx.restore();
      }

      // Glowing Center Sphere
      ctx.beginPath();
      ctx.arc(centerX, centerY, isCallActive ? 10 : 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isCallActive ? 20 : isRinging ? 16 : 10;
      ctx.fill();

      // Inner Core Highlight
      ctx.beginPath();
      ctx.arc(centerX - 2, centerY - 2, isCallActive ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 6;
      ctx.fill();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationFrameId);
  }, [status]);

  return (
    <div className="relative flex items-center justify-center w-24 h-24 select-none pointer-events-none">
      <canvas ref={canvasRef} width={96} height={96} className="w-full h-full" />
    </div>
  );
};
