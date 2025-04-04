// require("dotenv").config();
// const express = require("express");
// const { Telegraf } = require("telegraf");
// const mongoose = require("mongoose");

// const bot = new Telegraf(process.env.BOT_TOKEN);
// const app = express();
// app.use(express.json());

// const ADMIN_ID = process.env.ADMIN_ID; // ID администратора

// // Подключение к MongoDB
// mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
// 	.then(() => console.log("✅ MongoDB подключен"))
// 	.catch(err => console.log("❌ Ошибка подключения:", err));

// // Модель пользователя
// const User = mongoose.model("User", new mongoose.Schema({
// 	telegramId: String,
// 	name: String,
// 	age: Number,
// }));

// // Состояние пользователей
// const userStates = {};

// // Обработчик /start
// bot.start(ctx => {
// 	ctx.reply("Привет! Как вас зовут?");
// 	userStates[ctx.from.id] = { step: "name" };
// });

// // Обработка сообщений от пользователя
// bot.on("text", async (ctx) => {
// 	const userId = ctx.from.id;
// 	const message = ctx.message.text.trim();

// 	//list
// 	if (message === "/list") {
// 		//console.log("find list");

// 		if (userId.toString() !== ADMIN_ID) {
// 			ctx.reply("⛔ У вас нет доступа.");
// 			return;
// 		}
// 		const users = await User.find();
// 		if (users.length === 0) {
// 			ctx.reply("👤 Список пользователей пуст.");
// 		} else {
// 			let response = "📋 Список пользователей:\n";
// 			users.forEach(user => {
// 				response += `🆔 ${user.telegramId}\n👤 ${user.name}, ${user.age} лет\n\n`;
// 			});
// 			ctx.reply(response);
// 		}

// 		return;
// 	}

// 	if (!userStates[userId]) return;

// 	if (userStates[userId].step === "name") {
// 		userStates[userId].name = message;
// 		userStates[userId].step = "age";
// 		ctx.reply("Сколько вам лет?");
// 	} else if (userStates[userId].step === "age") {
// 		const age = parseInt(message);
// 		if (isNaN(age) || age <= 0) {
// 			ctx.reply("Введите корректный возраст.");
// 			return;
// 		}

// 		userStates[userId].age = age;

// 		// Сохранение в MongoDB
// 		await User.create({
// 			telegramId: userId,
// 			name: userStates[userId].name,
// 			age: userStates[userId].age,
// 		});

// 		ctx.reply(`Спасибо! Вы: ${userStates[userId].name}, ${userStates[userId].age} лет.`);
// 		delete userStates[userId]; // Очистка состояния
// 	}
// });

// Установка Webhook
// const WEBHOOK_URL = `https://${process.env.RENDER_DOMAIN}/telegram-bot`;
// bot.telegram.setWebhook(WEBHOOK_URL);
// app.use(bot.webhookCallback("/telegram-bot"));

// // Запуск бота в режиме polling for local test 
// bot.telegram.deleteWebhook();
// bot.launch();
// console.log("🤖 Бот запущен в режиме polling");


// // Запуск сервера
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
// 	console.log(`🚀 Бот работает на порту ${PORT}`);
// });


require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const moment = require("moment");

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

const ADMIN_ID = process.env.ADMIN_ID;

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
	.then(() => console.log("✅ MongoDB подключен"))
	.catch(err => console.log("❌ Ошибка подключения:", err));

// Модель
const User = mongoose.model("User", new mongoose.Schema({
	telegramId: String,
	name: String,
	age: Number,
}));

// Временные состояния
const userStates = {};
const pendingDeletes = {}; // { adminId: { telegramId, name } }

// /start
bot.start(ctx => {
	ctx.reply("Привет! Как вас зовут?");
	userStates[ctx.from.id] = { step: "name" };
});

// Обработка текста
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

	// Если не в процессе опроса — выход
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

// Обработка callback-кнопок
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
				Markup.button.callback("✅ Да, удалить", `delete_confirmed`),
				Markup.button.callback("↩️ Отмена", `cancel`)
			])
		);

		ctx.answerCbQuery();
		return;
	}

	// Удаление после подтверждения
	if (data === "delete_confirmed") {
		const pending = pendingDeletes[userId];
		if (!pending) {
			ctx.answerCbQuery("⛔️ Ошибка: нет данных для удаления.");
			return;
		}

		const result = await User.deleteOne({ telegramId: pending.telegramId });
		delete pendingDeletes[userId];

		if (result.deletedCount === 0) {
			await ctx.editMessageText("❌ Пользователь не найден или уже удален.");
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

	// Отмена
	if (data === "cancel") {
		delete pendingDeletes[userId];
		await ctx.editMessageText("❎ Удаление отменено.");
		ctx.answerCbQuery("❎ Отменено");
		return;
	}
});

//Установка Webhook
const WEBHOOK_URL = `https://${process.env.RENDER_DOMAIN}/telegram-bot`;
bot.telegram.setWebhook(WEBHOOK_URL);
app.use(bot.webhookCallback("/telegram-bot"));


// polling (локальный запуск)
//  bot.telegram.deleteWebhook();
//  bot.launch();
//  console.log("🤖 Бот запущен в режиме polling");

// express сервер (если нужно)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`🚀 Бот работает на порту ${PORT}`);
});