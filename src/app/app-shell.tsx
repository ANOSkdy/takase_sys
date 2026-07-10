"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { appNavigationItems } from "./navigation";
import styles from "./app-shell.module.css";

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  const nav = (
    <nav className={styles.nav} aria-label="アプリケーション">
      {appNavigationItems.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={styles.navLink}
            data-active={active}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.title : undefined}
            onClick={() => setDrawerOpen(false)}
          >
            <span className={styles.navIcon} aria-hidden>
              {item.icon}
            </span>
            <span className={styles.navText}>{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className={styles.shell} data-collapsed={collapsed}>
      <header className={styles.header}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.mobileMenuButton}
          aria-label="ナビゲーションを開く"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <Link href="/" className={styles.brand}>
          タカセシステム
        </Link>
        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? "ナビゲーションを展開" : "ナビゲーションを折りたたむ"}
          aria-pressed={collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </header>
      <aside className={styles.sidebar}>{nav}</aside>
      {drawerOpen ? (
        <div
          className={styles.drawerLayer}
          role="presentation"
          onMouseDown={() => {
            setDrawerOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        >
          <aside
            className={styles.drawer}
            aria-label="モバイルナビゲーション"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.drawerHeader}>
              <Link href="/" className={styles.brand}>
                タカセシステム
              </Link>
              <button
                type="button"
                className={styles.mobileMenuButton}
                onClick={() => {
                  setDrawerOpen(false);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                aria-label="ナビゲーションを閉じる"
              >
                ×
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}
      <main className={styles.content}>{children}</main>
    </div>
  );
}
