import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

class NotificationService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass
      }
    });
  }

  async sendEmail(to: string, subject: string, htmlContent: string, userId?: number, type: string = 'ORDER_EMAIL') {
    // EMAIL OPTION COMMENTED OUT FOR NOW - WILL IMPLEMENT LATER ON
    logger.info(`[Email Service - Commented Out] Email option disabled. Skipped sending '${subject}' to ${to}`);
    return true;
    /*
    try {
      logger.info(`[Email Service] Sending '${subject}' to ${to}`);

      // Log notification in DB
      await prisma.notification.create({
        data: {
          userId,
          email: to,
          type,
          channel: 'EMAIL',
          status: 'SENT',
          payload: JSON.stringify({ subject, to })
        }
      });

      // Attempt actual SMTP send if configured
      if (config.smtp.user && config.smtp.pass) {
        await this.transporter.sendMail({
          from: config.smtp.from,
          to,
          subject,
          html: htmlContent
        });
      } else {
        logger.info(`[Email Service] Mock Send: SMTP credentials not set. Message logged.`);
      }
      return true;
    } catch (error: any) {
      logger.error(`[Email Service Failure] ${error.message}`);
      await prisma.notification.create({
        data: {
          userId,
          email: to,
          type,
          channel: 'EMAIL',
          status: 'FAILED',
          payload: JSON.stringify({ subject, error: error.message })
        }
      });
      return false;
    }
    */
  }

  async sendSMS(phoneNumber: string, message: string, userId?: number, email: string = '') {
    // SMS OPTION COMMENTED OUT FOR NOW - WILL IMPLEMENT LATER ON
    return true;
    /*
    try {
      logger.info(`[SMS Service] Dispatching to ${phoneNumber}: ${message}`);
      await prisma.notification.create({
        data: {
          userId,
          email: email || phoneNumber,
          type: 'ORDER_SMS',
          channel: 'SMS',
          status: 'SENT',
          payload: message
        }
      });
      return true;
    } catch (error: any) {
      logger.error(`[SMS Service Failure] ${error.message}`);
      return false;
    }
    */
  }

  async sendPushNotification(email: string, title: string, body: string, userId?: number) {
    // PUSH NOTIFICATION OPTION COMMENTED OUT FOR NOW - WILL IMPLEMENT LATER ON
    return true;
    /*
    try {
      logger.info(`[Push Service] Web Push to ${email}: ${title} - ${body}`);
      await prisma.notification.create({
        data: {
          userId,
          email,
          type: 'ORDER_PUSH',
          channel: 'PUSH',
          status: 'SENT',
          payload: JSON.stringify({ title, body })
        }
      });
      return true;
    } catch (error: any) {
      logger.error(`[Push Service Failure] ${error.message}`);
      return false;
    }
    */
  }

  // High level order status triggers
  async notifyOrderStatusChange(order: any, newStatus: string) {
    const trackingUrl = `${config.baseUrl}/track-order?orderNumber=${order.orderNumber}&email=${encodeURIComponent(order.email)}`;
    
    let emailSubject = '';
    let emailHtml = '';
    let smsText = '';
    let pushTitle = '';
    let pushBody = '';

    switch (newStatus) {
      case 'PENDING':
        emailSubject = `Order Placed Successfully! #${order.orderNumber}`;
        emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #c97380;">Thank you for your order, ${order.customerName}!</h2>
            <p>Your order <strong>#${order.orderNumber}</strong> has been received and is currently pending confirmation.</p>
            <h3>Order Summary:</h3>
            <p>Total Amount: <strong>$${order.total.toFixed(2)}</strong></p>
            <p>Track your shipment progress here: <a href="${trackingUrl}">${trackingUrl}</a></p>
          </div>
        `;
        smsText = `E-Beauty: Your order #${order.orderNumber} ($${order.total.toFixed(2)}) was received! Track: ${trackingUrl}`;
        pushTitle = 'Order Placed';
        pushBody = `Your order #${order.orderNumber} has been received.`;
        break;

      case 'CONFIRMED':
        emailSubject = `Order Confirmed - #${order.orderNumber}`;
        emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #2e7d32;">Order Confirmed!</h2>
            <p>Great news! Your order <strong>#${order.orderNumber}</strong> has been verified by our team.</p>
          </div>
        `;
        pushTitle = 'Order Confirmed';
        pushBody = `Order #${order.orderNumber} has been confirmed by our store.`;
        break;

      case 'SHIPPED':
        emailSubject = `Your Order #${order.orderNumber} Has Been Shipped!`;
        emailHtml = `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #1976d2;">Shipment On Its Way!</h2>
            <p>Carrier: <strong>${order.shippingCarrier || 'Standard Delivery'}</strong></p>
            <p>Tracking Number: <strong>${order.trackingNumber || 'N/A'}</strong></p>
            <p><a href="${trackingUrl}" style="background: #c97380; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px;">Track Package</a></p>
          </div>
        `;
        smsText = `E-Beauty: Order #${order.orderNumber} shipped via ${order.shippingCarrier || 'Carrier'}! Track: ${order.trackingNumber || trackingUrl}`;
        pushTitle = 'Order Shipped';
        pushBody = `Order #${order.orderNumber} is on the way! Tracking: ${order.trackingNumber || ''}`;
        break;

      case 'OUT_FOR_DELIVERY':
        emailSubject = `Out for Delivery: #${order.orderNumber}`;
        emailHtml = `<p>Your package #${order.orderNumber} is out for delivery today!</p>`;
        smsText = `E-Beauty: Order #${order.orderNumber} is out for delivery today!`;
        pushTitle = 'Out for Delivery';
        pushBody = `Package #${order.orderNumber} will be delivered today.`;
        break;

      case 'DELIVERED':
        emailSubject = `Delivered! Order #${order.orderNumber}`;
        emailHtml = `<p>Your package #${order.orderNumber} has been delivered. Enjoy your beauty items!</p>`;
        smsText = `E-Beauty: Order #${order.orderNumber} has been delivered!`;
        pushTitle = 'Package Delivered';
        pushBody = `Order #${order.orderNumber} was delivered successfully.`;
        break;

      case 'CANCELLED':
        emailSubject = `Order Cancellation Notice - #${order.orderNumber}`;
        emailHtml = `<p>Your order #${order.orderNumber} has been cancelled. Contact support for any queries.</p>`;
        smsText = `E-Beauty: Order #${order.orderNumber} has been cancelled.`;
        break;
    }

    // EMAIL OPTION COMMENTED OUT - WILL IMPLEMENT LATER ON
    /*
    if (emailSubject) {
      await this.sendEmail(order.email, emailSubject, emailHtml, order.userId, `ORDER_${newStatus}`);
    }
    */
    if (smsText && order.phone) {
      await this.sendSMS(order.phone, smsText, order.userId, order.email);
    }
    if (pushTitle) {
      await this.sendPushNotification(order.email, pushTitle, pushBody, order.userId);
    }
  }
}

export const notificationService = new NotificationService();
