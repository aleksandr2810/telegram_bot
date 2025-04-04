require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const moment = require("moment");

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

const ADMIN_ID = process.env.ADMIN_ID;

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

// Состояния пользователей и удаления
const userStates = {};
const pendingDeletes = {};

// /start
bot.start(ctx => {
	ctx.reply("Привет! Как вас зовут?");
	userStates[ctx.from.id] = { step: "name" };
});

// Обработка текстов
bot.on("text", async (ctx) => {
	const userId = ctx.from.id;
	const message = ctx.message.text.trim();

	// Команда /list
	if (message === "/list") {
		if (userId.toString() !== ADMIN_ID) {
			ctx.reply("⛔️ У вас нет доступа.");
			return;
		}

		const users = await User.find();
		if (users.length === 0) {
			ctx.reply("👤 Список пользователей пуст.");
			return;
		}

		for (const user of users) {
			await ctx.reply(
				`🆔 ${user.telegramId}\n👤 ${user.name}, ${user.age} лет`,
				Markup.inlineKeyboard([
					Markup.button.callback(`❌ Удалить`, `confirm_${user.telegramId}`)
				])
			);
		}
		return;
	}

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

		await User.create({
			telegramId: userId,
			name: userStates[userId].name,
			age: userStates[userId].age,
		});

		ctx.reply(`Спасибо! Вы: ${userStates[userId].name}, ${userStates[userId].age} лет.`);
		delete userStates[userId];
	}
});

// Обработка нажатий кнопок
bot.on("callback_query", async (ctx) => {
	const userId = ctx.from.id;
	const data = ctx.callbackQuery.data;

	if (userId.toString() !== ADMIN_ID) {
		ctx.answerCbQuery("⛔️ Нет доступа.");
		return;
	}

	// Подтверждение
	if (data.startsWith("confirm_")) {
		const telegramId = data.split("confirm_")[1];
		const user = await User.findOne({ telegramId });

		if (!user) {
			ctx.answerCbQuery("❌ Пользователь не найден.");
			return;
		}

		pendingDeletes[userId] = { telegramId, name: user.name };

		await ctx.editMessageText(
			`❗ Вы уверены, что хотите удалить пользователя:\n👤 ${user.name} (${telegramId})?`,
			Markup.inlineKeyboard([
				Markup.button.callback("✅ Да, удалить", "delete_confirmed"),
				Markup.button.callback("↩️ Отмена", "cancel")
			])
		);

		ctx.answerCbQuery();
		return;
	}

	// Удаление подтверждено
	if (data === "delete_confirmed") {
		const pending = pendingDeletes[userId];
		if (!pending) {
			ctx.answerCbQuery("⛔️ Нет данных для удаления.");
			return;
		}

		const result = await User.deleteOne({ telegramId: pending.telegramId });
		delete pendingDeletes[userId];

		if (result.deletedCount === 0) {
			await ctx.editMessageText("❌ Пользователь не найден или уже удалён.");
		} else {
			await ctx.editMessageText(`✅ Пользователь ${pending.name} удалён.`);

			const time = moment().format("YYYY-MM-DD HH:mm");
			const adminUsername = ctx.from.username || `ID ${ctx.from.id}`;

			await bot.telegram.sendMessage(ADMIN_ID,
				`🗑 Пользователь удалён:\n` +
				`👤 Имя: ${pending.name}\n` +
				`🆔 Telegram ID: ${pending.telegramId}\n` +
				`👮 Удалил: @${adminUsername}\n` +
				`🕒 Время: ${time}`
			);
		}
		ctx.answerCbQuery();
		return;
	}

	// Отмена удаления
	if (data === "cancel") {
		delete pendingDeletes[userId];
		await ctx.editMessageText("❎ Удаление отменено.");
		ctx.answerCbQuery("❎ Отменено");
		return;
	}
});

// Webhook для продакшн
const WEBHOOK_URL = `https://${process.env.RENDER_DOMAIN}/telegram-bot`;
bot.telegram.setWebhook(WEBHOOK_URL);
app.use(bot.webhookCallback("/telegram-bot"));

console.log("🤖 Бот работает через Webhook:", WEBHOOK_URL);

// Запуск express сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`🚀 Сервер слушает порт ${PORT}`);
});