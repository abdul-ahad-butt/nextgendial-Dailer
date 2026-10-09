import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  glow?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  style = {},
  title,
  subtitle,
  action,
  glow = false,
}) => {
  return (
    <div
      className={`glass-card ${glow ? 'glass-card--glow' : ''} ${className}`}
      style={style}
    >
      {(title || action) && (
        <div className="glass-card-header">
          <div>
            {typeof title === 'string' ? (
              <h3 className="glass-card-title">{title}</h3>
            ) : (
              title
            )}
            {subtitle && <p className="glass-card-subtitle">{subtitle}</p>}
          </div>
          {action && <div className="glass-card-action">{action}</div>}
        </div>
      )}
      <div className="glass-card-body">{children}</div>
    </div>
  );
};
