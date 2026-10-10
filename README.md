# Zelio • Jangid • Spare Parts — Full Stack Store

## Stack
- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js + Express
- Database: MongoDB + Mongoose
- Admin auth: JWT + bcrypt
- Product images: Multer/local uploads
- Orders: saved in MongoDB + WhatsApp click-to-chat

## 1. Install
```bash
npm install
```

## 2. Configure
Copy `.env.example` to `.env` and change:
- MONGODB_URI
- JWT_SECRET
- ADMIN_EMAIL
- ADMIN_PASSWORD
- WHATSAPP_NUMBER (country code, no + or spaces)

For MongoDB Atlas, use your Atlas connection string in `MONGODB_URI`.

## 3. Run
```bash
npm run dev
```
or
```bash
npm start
```

Open:
- Store: http://localhost:5000
- Admin: http://localhost:5000/admin.html

The server automatically creates the admin user from ADMIN_EMAIL/ADMIN_PASSWORD if it does not exist.

## Admin
Login with the credentials from `.env`.
Admin can:
- Add products
- Upload product image
- Edit/delete products
- Change stock
- View orders
- Update order status

## WhatsApp flow
1. Customer adds products to cart.
2. Customer fills name, phone and address.
3. Backend validates stock and creates an order.
4. Server reduces stock.
5. Browser opens WhatsApp with a pre-filled order message.
6. Customer presses Send in WhatsApp.

This is a WhatsApp click-to-chat workflow. For fully automated server-side WhatsApp Business API messages, connect Meta WhatsApp Cloud API or another provider later.

## Production notes
- Put the app behind HTTPS.
- Use MongoDB Atlas or a secured MongoDB server.
- Store images on S3/Cloudinary rather than local disk when deploying to ephemeral hosting.
- Set a strong JWT_SECRET and admin password.
- Add rate limiting, CSRF/origin controls, validation and audit logs before public launch.
