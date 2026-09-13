package mailer

import (
	"crypto/tls"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"strings"
)

type Mailer struct {
	host string
	port string
	user string
	pass string
	from string
	tls  bool
}

// New builds a Mailer from the environment.
// SMTP_HOST (or MAILER_HOST) is required to send real mail; otherwise the
// mailer falls back to logging messages to stdout (local development without
// Mailpit).
func New() *Mailer {
	host := firstNonEmpty("SMTP_HOST", "MAILER_HOST")
	port := firstNonEmpty("SMTP_PORT", "MAILER_PORT", "1025")
	return &Mailer{
		host: host,
		port: port,
		user: firstNonEmpty("SMTP_USER", "MAILER_USER"),
		pass: firstNonEmpty("SMTP_PASSWORD", "MAILER_PASSWORD"),
		from: firstNonEmpty("SMTP_FROM", "MAILER_FROM", "Help Desk <helpdesk@fintara.com>"),
		tls:  os.Getenv("SMTP_TLS") == "true",
	}
}

func firstNonEmpty(keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

func (m *Mailer) enabled() bool { return m.host != "" }

// Send delivers an email. If SMTP is not configured it logs the message.
func (m *Mailer) Send(to, subject, body string) error {
	msg := m.render(to, subject, body)

	if !m.enabled() {
		log.Printf("[mail] dev fallback → to=%s subject=%q\n%s", to, subject, body)
		return nil
	}

	addr := net.JoinHostPort(m.host, m.port)

	var err error
	if m.tls {
		err = m.sendTLS(addr, msg)
	} else {
		// Only send AUTH when credentials are provided. Many dev mail
		// servers (Mailpit, etc.) do not advertise AUTH support and will
		// reject the handshake if we attempt it with empty credentials.
		var auth smtp.Auth
		if m.user != "" || m.pass != "" {
			auth = smtp.PlainAuth("", m.user, m.pass, m.host)
		}
		err = smtp.SendMail(addr, auth, m.from, []string{to}, msg)
	}
	if err != nil {
		return fmt.Errorf("send email: %w", err)
	}
	return nil
}

func (m *Mailer) render(to, subject, body string) []byte {
	return []byte(fmt.Sprintf(
		"From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\n%s\r\n",
		m.from, to, subject, body))
}

// sendTLS is used by SMTP servers that require implicit TLS (SMTPS, port 465).
func (m *Mailer) sendTLS(addr string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: m.host, MinVersion: tls.VersionTLS12})
	if err != nil {
		return err
	}
	defer conn.Close()

	c, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return err
	}
	defer c.Close()

	if m.user != "" {
		auth := smtp.PlainAuth("", m.user, m.pass, m.host)
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	if err := c.Mail(m.from); err != nil {
		return err
	}
	if err := c.Rcpt(toAddr(msg)); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	return w.Close()
}

func toAddr(msg []byte) string {
	for _, line := range strings.Split(string(msg), "\r\n") {
		if strings.HasPrefix(line, "To:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "To:"))
		}
	}
	return ""
}

// SendAccountCreated emails a newly created staff account's temporary password.
func (m *Mailer) SendAccountCreated(to, name, tempPassword string) error {
	body := fmt.Sprintf(`Hello %s,

An account has been created for you on the Help Desk platform.

Your temporary password is:

    %s

Sign in at the Help Desk portal and you will be required to set a new
password of your own before continuing.

If you did not expect this email, please contact your administrator.

- Help Desk Team`, name, tempPassword)
	return m.Send(to, "Your Help Desk account", body)
}

// SendOrgAdminInvite emails the first admin of a newly onboarded organization.
func (m *Mailer) SendOrgAdminInvite(to, name, orgName, tempPassword string) error {
	body := fmt.Sprintf(`Hello %s,

You have been made the administrator of "%s" on the Help Desk platform.

Your temporary password is:

    %s

Sign in and you will be required to set a new password. You can then create
accounts for your staff.

- Help Desk Team`, name, orgName, tempPassword)
	return m.Send(to, fmt.Sprintf("Administrator access for %s", orgName), body)
}

// SendPasswordReset emails the recipient a new temporary password (admin reset)
// or deliver the OTP for self-service resets.
func (m *Mailer) SendPasswordReset(to, name, newPassword string) error {
	body := fmt.Sprintf(`Hello %s,

Your Help Desk password was reset. Your new temporary password is:

    %s

You will be required to set a new password at your next sign in.

If you did not request this, contact your administrator immediately.

- Help Desk Team`, name, newPassword)
	return m.Send(to, "Your Help Desk password was reset", body)
}

// SendPasswordResetOTP emails a 6-digit code used to verify identity before a
// self-service password reset.
func (m *Mailer) SendPasswordResetOTP(to, name, code string) error {
	body := fmt.Sprintf(`Hello %s,

Use the following code to verify your identity and reset your password:

    %s

This code expires in 5 minutes.

If you did not request this, you can safely ignore this email.

- Help Desk Team`, name, code)
	return m.Send(to, "Your password reset code", body)
}

// SendLoginOTP emails a 6-digit code for OTP-based sign in.
func (m *Mailer) SendLoginOTP(to, name, code string) error {
	body := fmt.Sprintf(`Hello %s,

Your Help Desk sign-in code is:

    %s

This code expires in 5 minutes. Never share it with anyone.

- Help Desk Team`, name, code)
	return m.Send(to, "Your Help Desk sign-in code", body)
}