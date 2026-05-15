"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { appNavigationItems } from "./navigation";
import styles from "./shared-nav-header.module.css";

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SharedNavHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} onClick={() => setOpen(false)}>
        タカセシステム
      </Link>
      <button
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="ナビゲーションメニュー"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.hamburger} aria-hidden>
          ☰
        </span>
      </button>

      <nav id={menuId} className={`${styles.nav} ${open ? styles.navOpen : ""}`}>
        {appNavigationItems.map((link) => {
          const active = isActivePath(pathname, link.href);
          return (
            <Link
              key={`${link.href}-${link.title}`}
              href={link.href}
              className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
              onClick={() => setOpen(false)}
            >
              <span className={styles.navTitle}>{link.title}</span>
              <span className={styles.navDescription}>{link.description}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
