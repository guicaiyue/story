import type { ReactNode } from 'react';
import { Alert, Skeleton } from 'antd';

/** 页头：标题 + 副标题 + 右侧操作区。 */
export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

/** 纸感卡片容器。 */
export function PaperCard({
  title,
  hint,
  extra,
  children,
  style,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section className="paper-card" style={style}>
      {title || extra ? (
        <div className="card-head">
          <div>
            <span className="card-title">{title}</span>
            {hint ? <span className="card-hint" style={{ marginLeft: 10 }}>{hint}</span> : null}
          </div>
          {extra}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * 统一的加载/错误包装。
 *
 * 06 关键约束：失败不能白屏 —— 错误以可读文案 + 重试按钮呈现，
 * 加载态用骨架屏而不是空白。
 */
export function AsyncBlock({
  loading,
  error,
  onRetry,
  skeletonRows = 4,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  skeletonRows?: number;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div data-testid="loading">
        <Skeleton active paragraph={{ rows: skeletonRows }} />
      </div>
    );
  }
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载失败"
        description={error}
        data-testid="load-error"
        action={
          onRetry ? (
            <button type="button" className="ant-btn ant-btn-sm" onClick={onRetry}>
              重试
            </button>
          ) : undefined
        }
      />
    );
  }
  return <>{children}</>;
}
