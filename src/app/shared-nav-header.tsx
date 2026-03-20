"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import styles from "./shared-nav-header.module.css";

const links = [
  { href: "/records", label: "仕切り表" },
  { href: "/documents", label: "納品書PDF" },
] as const;

export default function SharedNavHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();


  return (
    <header className={styles.header}>
      <div className={styles.brand}>タカセシステム</div>
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
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
