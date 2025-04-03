require("dotenv").config();
const express = require("express");
const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

const ADMIN_ID = process.env.ADMIN_ID; // ID администратора

// Подключение к MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
	.then(() => console.log("✅ MongoDB подключен"))
	.catch(err => console.log("❌ Ошибка подключения:", err));

// Модель пользователя
const User = mongoose.model("User", new mongoose.Schema({
	telegramId: String,
	name: String,
	age: Number,
}));

// Состояние пользователей
const userStates = {};

// Обработчик /start
bot.start(ctx => {
	ctx.reply("Привет! Как вас зовут?");
	userStates[ctx.from.id] = { step: "name" };
});

// Обработка сообщений от пользователя
bot.on("text", async (ctx) => {
	const userId = ctx.from.id;
	const message = ctx.message.text;

	if (!userStates[userId]) return;

	if (userStates[userId].step === "name") {
		userStates[userId].name = message;
		userStates[userId].step = "age";
		ctx.reply("Сколько вам лет?");
	} else if (userStates[userId].step === "age") {
		const age = parseInt(message);
		if (isNaN(age) || age <= 0) {
			ctx.reply("Введите корректный возраст.");
			return;
		}

		userStates[userId].age = age;

		// Сохранение в MongoDB
		await User.create({
			telegramId: userId,
			name: userStates[userId].name,
			age: userStates[userId].age,
		});

		ctx.reply(`Спасибо! Вы: ${userStates[userId].name}, ${userStates[userId].age} лет.`);
		delete userStates[userId]; // Очистка состояния
	}
});

// Команда /list (только для админа)
bot.command("list", async (ctx) => {
	if (ctx.from.id.toString() !== ADMIN_ID) {
		ctx.reply("⛔ У вас нет доступа.");
		return;
	}

	const users = await User.find();
	if (users.length === 0) {
		ctx.reply("👤 Список пользователей пуст.");
	} else {
		let response = "📋 Список пользователей:\n";
		users.forEach(user => {
			response += `🆔 ${user.telegramId}\n👤 ${user.name}, ${user.age} лет\n\n`;
		});
		ctx.reply(response);
	}
});

// Установка Webhook
const WEBHOOK_URL = `https://${process.env.RENDER_DOMAIN}/telegram-bot`;
bot.telegram.setWebhook(WEBHOOK_URL);
app.use(bot.webhookCallback("/telegram-bot"));

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`🚀 Бот работает на порту ${PORT}`);
});